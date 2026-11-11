/*
 * 计量小帮手 · 单文件版
 *
 * 这个文件被 tools/build_standalone.mjs 打包进最终 HTML，所以：
 *   - 不能 import，知识库由 __KB__ 占位符注入
 *   - 没有后端，检索和调模型全在浏览器里做
 *   - API Key 存在 localStorage，第一次用会提示填
 */
'use strict';

// 占位符：打包时替换成真实数据
const KB = window.__KB__;

/* 打包时预置的 Key（由 keys.js 还原后挂在 window 上），localStorage 里的优先 */
const DEFAULT_KEYS = window.__KEYS__ || {};

/**
 * 能直连的模型服务。两家都验证过允许浏览器跨域（DeepSeek 会回显任意 Origin，
 * OpenRouter 返回 *），所以这个 HTML 不需要任何后端。
 */
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    headers: {},
  },
  openrouter: {
    label: 'OpenRouter 免费池',
    base: 'https://openrouter.ai/api/v1',
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-4-26b-a4b-it:free',
      'dots-studio/dots-3-note-preview:free',
      'liquid/lfm-3-1.7b:free',
    ],
    headers: {},
  },
};

const TOP_K = 8;
const CHUNK_MAX = 1400;
const MAX_TURNS = 8;

// ---------------------------------------------------------------------------
// 检索：中文 2-gram 倒排，够用且能解释
// ---------------------------------------------------------------------------

const CJK = /[\u4e00-\u9fff]/;

function tokenize(text) {
  const out = [];
  let cjk = '';
  let en = '';
  const flushCjk = () => {
    if (!cjk) return;
    if (cjk.length === 1) out.push(cjk);
    else for (let i = 0; i < cjk.length - 1; i++) out.push(cjk.slice(i, i + 2));
    cjk = '';
  };
  const flushEn = () => {
    if (!en) return;
    out.push(en.toLowerCase());
    en = '';
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      flushEn();
      cjk += ch;
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      flushCjk();
      en += ch;
    } else {
      flushCjk();
      flushEn();
    }
  }
  flushCjk();
  flushEn();
  return out;
}

/**
 * 把知识文件切成块。
 *
 * 三档粒度：
 *   1. 一行一个列表项（「- 计算机科学与技术｜计划 210 人」）单独成块
 *      —— 招生计划那种大表格，整块切会被 1400 字上限截断，单条数据根本检索不到
 *   2. 二级/三级标题分节
 *   3. 普通段落按 CHUNK_MAX 累积
 */
function buildChunks() {
  const chunks = [];
  for (const doc of KB) {
    const lines = String(doc.t || '').split('\n');
    let heading = '';
    let buf = [];
    let bufLen = 0;

    const push = () => {
      const text = buf.join('\n').trim();
      buf = [];
      bufLen = 0;
      if (text.length < 40) return;
      chunks.push({ file: doc.f, heading, text: text.slice(0, CHUNK_MAX), kind: 'para' });
    };

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#{2,3}\s/.test(line)) {
        push();
        heading = line.replace(/^#{2,3}\s*/, '').trim();
        continue;
      }

      // 列表项一行就是一条事实，单独成块，避免被同节其它内容稀释
      const isItem = /^[-*•]\s+/.test(trimmed) || /^\d+[.、]\s+/.test(trimmed);
      if (isItem && trimmed.length >= 12) {
        push();
        chunks.push({ file: doc.f, heading, text: trimmed, kind: 'item' });
        continue;
      }

      buf.push(line);
      bufLen += line.length + 1;
      if (bufLen > CHUNK_MAX) push();
    }
    push();
  }
  // 预建词表，省得每次查询重算
  for (const c of chunks) c.terms = new Set(tokenize(c.heading + ' ' + c.text));
  return chunks;
}

const CHUNKS = buildChunks();

/**
 * 文档频率：一个词出现在多少个块里。
 * 「中国」「计量」「大学」这种到处都是的词必须压权重，否则它们把真正有用的
 * 「博士」「住宿费」「保研」全冲掉了。
 */
const DF = (() => {
  const df = new Map();
  for (const c of CHUNKS) for (const t of c.terms) df.set(t, (df.get(t) || 0) + 1);
  return df;
})();

const TOTAL = CHUNKS.length;
function idf(term) {
  const df = DF.get(term) || 1;
  // 「计量」「大学」「学校」这种每条资料里都有的词，区分度为 0，留着只会淹没关键词
  if (df / TOTAL > 0.4) return 0.2;
  return Math.log(1 + TOTAL / df);
}

/**
 * 查之前先抠掉「中国计量大学」这类必然出现、却对检索毫无帮助的词。
 * 不抠的话「中国计量大学有几个博士点」里「中国/计量/大学」三个词的命中量
 * 会把唯一有用的「博士」压掉，模型就只能回答「资料里没有」。
 */
const QUERY_NOISE = [
  '中国计量大学', '计量大学', '中量大', '中国计量学院',
  '我们学校', '咱们学校', '贵校', '咱学校', '学校', '校内',
];

function cleanQuery(q) {
  let s = q;
  for (const w of QUERY_NOISE) s = s.split(w).join(' ');
  return s.trim() || q;
}

function search(question) {
  const qTerms = [...new Set(tokenize(cleanQuery(question)))];
  if (!qTerms.length) return [];
  const scored = [];
  for (const c of CHUNKS) {
    let score = 0;
    let hit = 0;
    for (const t of qTerms) {
      if (!c.terms.has(t)) continue;
      hit++;
      // 双字词是主力，单字（「几」「的」）只算零头
      score += idf(t) * (t.length >= 2 ? 1 : 0.3);
    }
    if (!hit) continue;
    const lenPenalty = Math.sqrt(c.text.length / 400 + 1);
    const itemBonus = c.kind === 'item' ? 1.15 : 1;
    scored.push({ chunk: c, score: (score * itemBonus) / lenPenalty, hit });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_K);
}

// ---------------------------------------------------------------------------
// 门控：跟服务端 guard.mjs 同一套规则
// ---------------------------------------------------------------------------

const CAMPUS_SIGNALS = [
  '计量', '量大', '中量大', 'cjlu', '学校', '校园', '校区', '下沙', '东区', '西区',
  '学源街', '钱塘', '学院', '专业', '选课', '绩点', '学分', '学费', '宿舍', '食堂',
  '图书馆', '校园卡', '一卡通', '校历', '教务', '辅导员', '班主任', '社团', '学生会',
  '军训', '毕业', '论文', '答辩', '保研', '推免', '考研', '转专业', '奖学金', '助学金',
  '四六级', '普通话', '实习', '就业', '校招', '开学', '报到', '放假', '假期', '寒假',
  '暑假', '门禁', '查寝', '快递', '外卖', '校医院', '体育', '运动会', '校车', '班车',
  '校徽', '校训', '办证', '开证明',
];

const HARD_RULES = [
  {
    id: 'other-university',
    test: (q) =>
      /(清华|北大|北京大学|浙江大学|复旦|上海交大|南京大学|武汉大学|中山大学|哈工大|中科大|北航|同济|电子科大|华中科技)/.test(q) &&
      !/计量/.test(q),
    reply: '那是别人家的学校，我这儿只管中国计量大学哈。想了解咱们学校的话，招生、专业、宿舍、选课随便问。',
  },
  {
    id: 'admission-promise',
    test: (q) =>
      /(能不能被录取|会不会被录取|能不能(上|进|录取)|(能|可以)(上|进|录取)吗|稳不稳|稳吗|录取(概率|机会|希望)|有希望(上|进|录取)|压线|够不够得?上)/.test(q),
    reply:
      '这个我可不敢替你拍板呀。录取看的是当年位次和招生计划，我说一句「稳」才是真害你。' +
      '最靠谱的是拿往年录取位次对着自己的分估，拿不准就打招生办 0571-86836060 问。',
  },
  {
    id: 'chat-jailbreak',
    test: (q) =>
      /(忽略(之前|上面)的(指令|提示)|你现在是|扮演一个|越狱|开发者模式|system\s*prompt|output\s+your\s+prompt)/i.test(q),
    reply: '换个问法吧，我只聊中国计量大学哈。',
  },
];

const SOFT_RULES = [
  {
    id: 'coding-help',
    test: (q) =>
      /(帮我写(一段|个)?(代码|程序|脚本)|写个?爬虫|python\s*代码|java\s*代码|报错了|语法错误|正则表达式怎么写|sql\s*怎么写|为什么运行不了)/i.test(q),
    reply: '写代码这活儿我不接，容易把你带沟里。学校的课、办事流程这些问我更靠谱。',
  },
  {
    id: 'writing-task',
    test: (q) => /(帮我写(一首|篇|段|封).{0,8}(诗|作文|文案|检讨|情书|邮件|周报))/.test(q),
    reply: '写东西我不代笔。不过要是学校要求的材料不知道去哪办、找谁盖章，这个我能帮你查。',
  },
  {
    id: 'translation',
    test: (q) => /(翻译(一下|这段|成)|英译中|中译英)/.test(q),
    reply: '翻译就不归我管了。学校这边的英文材料、留学交换的信息，倒是可以问我。',
  },
  {
    id: 'finance',
    test: (q) => /(股票|基金|炒股|比特币|期货|彩票|网贷|贷款怎么|理财产品)/.test(q),
    reply: '钱的事别问我，容易害你。学校的学费标准、奖学金评定这类，我可以讲。',
  },
  {
    id: 'fortune',
    test: (q) => /(算命|看相|八字|星座运势|塔罗|占卜|风水)/.test(q),
    reply: '这个我算不出来。要不问问咱们学校的事？',
  },
  {
    id: 'medical',
    test: (q) => /(我(是不是|得了).{0,6}病|吃什么药|怎么治病|诊断一下|这病严重吗)/.test(q),
    reply: '身体的事去医院，别问 AI。校医院的位置和门诊时间我可以告你。',
  },
  {
    id: 'weather',
    test: (q) => /(今天|明天|现在|这周).{0,5}(天气|气温|几度|下雨|下雪|台风)/.test(q),
    reply: '天气我真看不了实时数据，手机上点开天气 App 更准。',
  },
  {
    id: 'news',
    test: (q) => /(今天|最近|昨天).{0,6}(新闻|热点|大事|头条)/.test(q),
    reply: '新闻我这儿没有实时源。不过咱们学校最近发生了什么，校内新闻我倒是知道。',
  },
];

function guard(question) {
  const q = String(question || '').trim();
  if (!q) return { blocked: true, rule: 'empty', reply: '你想问点什么？' };
  const hasCampusSignal = CAMPUS_SIGNALS.some((w) => q.includes(w));

  for (const r of HARD_RULES) if (r.test(q)) return { blocked: true, rule: r.id, reply: r.reply };

  if (hasCampusSignal) return { blocked: false, hasCampusSignal: true };

  for (const r of SOFT_RULES) if (r.test(q)) return { blocked: true, rule: r.id, reply: r.reply };

  return { blocked: false, hasCampusSignal: false };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const chatEl = $('chat');
const introEl = $('intro');
const formEl = $('form');
const inputEl = $('input');
const sendEl = $('send');
const kbStatEl = $('kb-stat');
const selEl = $('sel-provider');
const drawerEl = $('drawer');
const scrimEl = $('scrim');
const drawerBodyEl = $('drawer-body');
const tplMsg = $('tpl-msg');

const state = { history: [], busy: false, lastSources: [] };

function readKeys() {
  try {
    return JSON.parse(localStorage.getItem('cjlu_keys') || '{}') || {};
  } catch {
    return {};
  }
}

function getKey(pid) {
  return readKeys()[pid] || DEFAULT_KEYS[pid] || '';
}

function saveKey(pid, key) {
  const all = readKeys();
  all[pid] = key;
  localStorage.setItem('cjlu_keys', JSON.stringify(all));
}

/** 当前选哪一家：'deepseek' | 'openrouter' */
function getChoice() {
  const saved = localStorage.getItem('cjlu_provider');
  return PROVIDERS[saved] ? saved : 'deepseek';
}

function setChoice(pid) {
  localStorage.setItem('cjlu_provider', pid);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 极简 Markdown：只认粗体、行内代码、列表、换行 */
function render(text) {
  let h = escapeHtml(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const lines = h.split('\n');
  let out = '';
  let inList = null;
  for (const line of lines) {
    const t = line.trim();
    const ol = t.match(/^\d+[.、]\s+(.*)$/);
    const ul = t.match(/^[-*•]\s+(.*)$/);
    if (ol || ul) {
      const tag = ol ? 'ol' : 'ul';
      if (inList !== tag) {
        if (inList) out += `</${inList}>`;
        out += `<${tag}>`;
        inList = tag;
      }
      out += `<li>${ol ? ol[1] : ul[1]}</li>`;
    } else {
      if (inList) {
        out += `</${inList}>`;
        inList = null;
      }
      if (!t) continue;
      out += /^#{1,4}\s/.test(t) ? `<p class="h">${t.replace(/^#{1,4}\s*/, '')}</p>` : `<p>${t}</p>`;
    }
  }
  if (inList) out += `</${inList}>`;
  return out;
}

function addMessage(role, text) {
  if (introEl && introEl.parentNode) introEl.remove();
  const node = tplMsg.content.firstElementChild.cloneNode(true);
  node.classList.add(role === 'user' ? 'user' : 'bot');
  node.querySelector('.avatar').textContent = role === 'user' ? '我' : '量';
  node.querySelector('.bubble').innerHTML = render(text);
  chatEl.appendChild(node);
  chatEl.scrollTop = chatEl.scrollHeight;
  return node;
}

function updateBubble(node, text) {
  node.querySelector('.bubble').innerHTML = render(text);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function showTyping(node) {
  node.querySelector('.bubble').innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
}

function showSources(list) {
  state.lastSources = list;
  if (!list.length) {
    drawerBodyEl.innerHTML = '<p class="empty">这次没有命中知识库。</p>';
    return;
  }
  drawerBodyEl.innerHTML = list
    .map(
      (s, i) =>
        `<div class="src"><div class="src-head"><b>资料${i + 1}</b> · ${escapeHtml(s.file)}${
          s.heading ? ' / ' + escapeHtml(s.heading) : ''
        }</div><div class="src-body">${escapeHtml(s.preview)}…</div></div>`
    )
    .join('');
}

function setBusy(v) {
  state.busy = v;
  sendEl.disabled = v;
  inputEl.disabled = v;
}

// ---------------------------------------------------------------------------
// 调用模型（浏览器直连，没有后端）
// ---------------------------------------------------------------------------

async function callModel(pid, model, messages, onDelta) {
  const p = PROVIDERS[pid];
  if (!p) throw new Error(`未知的模型服务：${pid}`);
  const key = getKey(pid);
  if (!key) throw new Error(`${p.label} 还没有填 API Key，点右上角下拉框选「⚙ 更换 API Key」`);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...p.headers };
  if (pid === 'openrouter') {
    headers['HTTP-Referer'] = location.href;
    headers['X-Title'] = 'cjlu-qa-standalone';
  }

  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 1200 }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for await (const piece of res.body) {
    buf += decoder.decode(piece, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(full);
        }
      }
    }
  }
  return full;
}

/** 同一家内部按模型清单依次降级（DeepSeek 两个模型、OpenRouter 四个免费模型） */
async function callWithFallback(pid, messages, onDelta, onModel) {
  const p = PROVIDERS[pid];
  const errors = [];
  for (const model of p.models) {
    try {
      onModel(`${p.label} · ${model}`);
      return await callModel(pid, model, messages, onDelta);
    } catch (e) {
      errors.push(`${model} → ${e.message}`);
      // 401/402/403 是 Key 的问题，换模型也没用，直接停
      if (e.status === 401 || e.status === 402 || e.status === 403) break;
    }
  }
  throw new Error(errors.join('\n'));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

// 这段在打包时会被 prompts/system-prompt.md 的全文整个替换掉。
// 想改提示词请改那个文件，不要改这里 —— 改这里下次 build 就被覆盖了。
const SYSTEM_PROMPT = /*__PROMPT_START__*/ `# 你是谁

你是中国计量大学的校园问答助手，学生们叫你「计量小帮手」。

把自己想成一个大三的学姐，正坐在图书馆门口被学弟学妹拦住问路。
你熟悉这所学校，也乐意多说两句，但不是那种拉着人讲半小时的类型 ——
问什么答什么，答完顺手提醒一句该注意的地方。

中国计量大学在杭州钱塘区，分东西两个校区：西区在学源街 258 号，东区在学源街 168 号。
学校 1978 年建校，2016 年从「中国计量学院」更名为「中国计量大学」，
校训是「精思国计、细量民生」，办学特色是计量、标准、质量、市场监管、检验检疫。

说话有温度，但不腻。可以说「哈」「呀」「这个我真不清楚」，别一口一个「亲」，
也别用「作为一个 AI 助手」「很高兴为您服务」这种客服腔 —— 学姐不会这么说话。

# 答案从哪儿来

下面会给你一段「参考资料」，那是从学校官网和校内文件里扒下来的原文。

优先级是这样的：

1. 参考资料里写了的，就按资料说，尽量把数字、时间、地点说准。
2. 资料里没写、但属于学校常识的（比如校训、校区位置），可以直接答。
3. 资料里没有、你也不确定的，直说不知道，然后告诉人家去哪儿问 ——
   招生的找招生办（0571-86836060 / 86836066），
   选课考试的找教务处，生活上的找后勤或者辅导员。
4. 绝对不许编。编一个「图书馆开放到 22:30」比说「我不确定」糟糕一百倍。

如果参考资料和你的记忆打架，以参考资料为准 —— 它是刚从官网抓的，比你旧。

# 什么该拒绝

这个机器人只管中国计量大学。**只有下面三类要拒**：

1. **跟学校完全没关系的正经活儿**：写代码、写作文、翻译、做题、算账。
   —— 这些不接，一句话推掉就行。
2. **别的学校**：问清华、浙大、杭电怎么样，不评价、不比较。
3. **要你替学校打包票的**：我这个分数能不能上、能不能保证转专业成功、能不能录取我。
   —— 这类只说规则和往年情况，绝不说「稳」「没问题」。分数够不够，让人家自己对着往年位次判断。

除此之外的都正常答，**尤其是**：

- 「杭州哪里好玩」「附近有什么好吃的」「周末去哪逛」—— 这是在校生的日常，好好答，
  推荐几个真去得多的地儿，别只报地铁站名。
- 「XX 专业学什么」「这个专业好不好就业」「XX 学院怎么样」—— 答，就业方向可以按专业特点说。
- 「宿舍几人间」「食堂贵不贵」这类生活问题 —— 答，这是新生最想知道的。

拒绝的时候别教训人，也别写一大段免责声明。一句话带过，顺手递个能问的方向。
比如：「这个我可帮不上忙哈，不过你要问咱们学校的选课规则，我倒是清楚。」

# 怎么说话

- 短。一般三五句话说完，能列点就列点，别写小作文。
- 具体。说「西区图书馆三楼」，不说「图书馆的某个楼层」。
- 有出处就说。涉及规定、时间、金额，末尾加一句「以学校最新通知为准」。
- 不确定就明说。别用「可能」「大概」糊弄过去，直接说这块没查到。
- 亲切但别啰嗦。一句「哈」能软化语气，三句就变成废话了。

# 输出格式

- 用中文，正常标点。
- 需要分步骤的（比如补办校园卡的流程）用有序列表，其余用短段落。
- 不要用一级标题，不要加粗整段话，看起来像公告栏就过头了。
- 不要输出 Markdown 表格，手机上看不清。

# 几个容易答错的点

- 学校有两个校区，「东区」「西区」别混。说地点时带上校区。
- 「量新学院」是荣誉学院，跟「计量测试与仪器学院」不是一回事。学院名别叫错：是「光学与电子科技学院」「材料与化学学院」「计量测试与仪器学院」。
- 招生电话是 0571-86836060、86836066，不是总机 0571-86914435，别搞混。
- 校名简称「量大」「中量大」都行，正式场合写全称。

# 参考资料

__KB_BLOCK__` /*__PROMPT_END__*/;

async function ask(question) {
  if (state.busy) return;
  const q = question.trim();
  if (!q) return;

  addMessage('user', q);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const g = guard(q);
  if (g.blocked) {
    const node = addMessage('bot', g.reply);
    node.classList.add('blocked');
    return;
  }

  const hits = search(q);
  showSources(
    hits.map((h) => ({ file: h.chunk.file, heading: h.chunk.heading, preview: h.chunk.text.slice(0, 120) }))
  );

  const kbBlock = hits.map((h, i) => `【资料${i + 1}】${h.chunk.file} / ${h.chunk.heading}\n${h.chunk.text}`).join('\n\n') || '（没有检索到相关资料）';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT.replace('__KB_BLOCK__', kbBlock) },
    ...state.history.slice(-MAX_TURNS * 2),
    { role: 'user', content: q },
  ];

  setBusy(true);
  const node = addMessage('bot', '');
  showTyping(node);

  let acc = '';
  try {
    const pid = getChoice();
    const answer = await callWithFallback(
      pid,
      messages,
      (full) => {
        acc = full;
        updateBubble(node, full);
      },
      (label) => {
        kbStatEl.textContent = `正在答 · ${label}`;
      }
    );
    updateBubble(node, answer || '（模型没有返回内容）');
    state.history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
    if (state.history.length > MAX_TURNS * 2) state.history = state.history.slice(-MAX_TURNS * 2);
  } catch (e) {
    node.classList.add('error');
    updateBubble(node, `调用失败：${e.message}`);
  } finally {
    setBusy(false);
    refreshStat();
    inputEl.focus();
  }
}

// ---------------------------------------------------------------------------
// 交互
// ---------------------------------------------------------------------------

function refreshStat() {
  const files = new Set(KB.map((d) => d.f)).size;
  kbStatEl.textContent = `知识库 ${files} 个文件 / ${CHUNKS.length} 段`;
}

function initModels() {
  selEl.innerHTML = '';
  for (const [pid, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = p.label;
    if (pid === getChoice()) opt.selected = true;
    selEl.appendChild(opt);
  }
  const gear = document.createElement('option');
  gear.value = '__key__';
  gear.textContent = '⚙ 更换 API Key';
  selEl.appendChild(gear);

  selEl.dataset.current = getChoice();
  selEl.addEventListener('change', () => {
    if (selEl.value === '__key__') {
      const pid = selEl.dataset.current;
      const p = PROVIDERS[pid];
      const hint =
        pid === 'deepseek'
          ? '填 DeepSeek API Key（platform.deepseek.com 后台创建，sk- 开头）'
          : '填 OpenRouter API Key（openrouter.ai/keys 免费领，sk-or- 开头）';
      const next = prompt(hint, getKey(pid));
      if (next !== null && next.trim()) {
        saveKey(pid, next.trim());
        alert(`已把 ${p.label} 的 Key 存在这台电脑的浏览器里。`);
      }
      selEl.value = pid;
      return;
    }
    setChoice(selEl.value);
    selEl.dataset.current = selEl.value;
  });
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  ask(inputEl.value);
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ask(inputEl.value);
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
});

document.querySelectorAll('.suggest-btn').forEach((b) => {
  b.addEventListener('click', () => ask(b.textContent));
});

$('btn-sources').addEventListener('click', () => {
  drawerEl.classList.add('open');
  scrimEl.classList.add('show');
});
$('btn-drawer-close').addEventListener('click', () => {
  drawerEl.classList.remove('open');
  scrimEl.classList.remove('show');
});
scrimEl.addEventListener('click', () => {
  drawerEl.classList.remove('open');
  scrimEl.classList.remove('show');
});

$('btn-clear').addEventListener('click', () => {
  state.history = [];
  chatEl.querySelectorAll('.msg').forEach((n) => n.remove());
  if (!document.getElementById('intro')) chatEl.insertAdjacentHTML('afterbegin', introHtml);
  bindSuggest();
  refreshStat();
});

const introHtml = introEl ? introEl.outerHTML : '';
function bindSuggest() {
  document.querySelectorAll('.suggest-btn').forEach((b) => {
    b.onclick = () => ask(b.textContent);
  });
}

initModels();
refreshStat();

// 两家都没配 Key 才提示（打包时一般已预置，这里只是兜底）
if (!getKey('deepseek') && !getKey('openrouter')) {
  setTimeout(() => {
    const next = prompt('这个文件还没配 API Key。填一个 DeepSeek 的（platform.deepseek.com 创建，sk- 开头）：', '');
    if (next && next.trim()) {
      saveKey('deepseek', next.trim());
      setChoice('deepseek');
      selEl.value = 'deepseek';
      selEl.dataset.current = 'deepseek';
    }
  }, 400);
}
