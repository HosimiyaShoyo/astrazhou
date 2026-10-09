# AstraZhou 博客 · 域名与部署

站点已经写完，是纯静态文件（无构建、无依赖）。剩下的只有「放上网」这一步。

---

## 先说清一件事：`astrazhou.com` 没有免费途径

- 我查了 Verisign 的 RDAP 接口：**`astrazhou.com` 目前没有被任何人注册**（返回 404 = 可注册）。
- 但 `.com` 是付费顶级域，注册局按年收费（约 ¥60–90/年），**不存在免费注册 `.com` 的渠道**。
- 曾经流行的免费域名 Freenom（`.tk / .ml / .ga / .cf / .gq`）**已全面停止服务**，不要再用。

所以「免费」只有下面两条路：用托管平台自带的免费子域，或申请免费二级域名。

---

## 路线 A：不要域名，5 分钟上线（推荐先走这条）

拿到的是免费子域，例如 `你的用户名.github.io` 或 `astrazhou.pages.dev`。

**GitHub Pages：**
1. 注册 GitHub 账号（免费）。
2. 新建一个仓库，名字必须是 `你的用户名.github.io`。
3. 把 `astrazhou/` 目录下的**所有文件**上传到仓库根目录
   （GitHub 网页版可以直接拖拽上传，不需要装 git）。
4. 等 1–2 分钟，访问 `https://你的用户名.github.io`。

**Cloudflare Pages（速度更快，国内访问通常更稳）：**
1. 注册 Cloudflare 账号（免费）。
2. Workers & Pages → 创建 Pages 项目 → 直连 Git 仓库或直接上传文件。
3. 部署完拿到 `项目名.pages.dev`。

> 这两条路都**不需要**在站点里放 CNAME 文件。等你以后绑定了自己的域名，再在仓库根目录新建一个名为 `CNAME` 的文件，内容就一行你的域名。

---

## 路线 B：免费二级域名 + 免费托管

如果你坚持要一个「自己的域名」，目前仍活跃的免费服务是 **DigitalPlat FreeDomain**
（<https://github.com/DigitalPlatDev/FreeDomain>），提供 `.dpdns.org`、`.us.kg` 等免费后缀。

大致流程（**具体以该仓库 README 的最新说明为准**，这类服务规则变动频繁）：
1. 用 GitHub 账号登录它的控制台。
2. 选一个后缀 + 你想要的二级域名（比如 `astrazhou.dpdns.org`），提交申请。
3. 在它的 DNS 面板里添加记录，指向路线 A 里的托管平台：
   - 类型 `CNAME`，名称 `astrazhou`，值 `你的用户名.github.io`（或 `项目名.pages.dev`）。
4. 在托管平台里把该域名添加为自定义域名。
5. 等待 DNS 生效（几分钟到几小时）。

**代价要知道：** 免费域名的所有权不在你手里，服务方可以随时收回或停止运营；搜索引擎收录也更慢。不适合长期正经运营。

---

## 路线 C：真要 `astrazhou.com`

1. 到域名注册商购买（阿里云/腾讯云/Cloudflare Registrar/Namecheap 等），约 ¥60–90/年。
2. 在注册商 DNS 面板添加解析：
   - `A` 记录，主机 `@` → 托管平台给出的 IP（GitHub Pages 为 4 个 IP，平台会显示）
   - `CNAME` 记录，主机 `www` → `你的用户名.github.io`
3. 仓库根目录新建 `CNAME` 文件，内容：`astrazhou.com`
4. 在托管平台后台填写自定义域名并开启 HTTPS（免费自动证书）。

---

## 本地预览

站点已经在本地跑起来了：

```
http://127.0.0.1:8088
```

改完文件刷新即可看到效果，没有构建步骤。

---

## 以后怎么加文章

1. 复制 `posts/hello-world.html`，改个文件名，比如 `posts/my-second-post.html`。
2. 改里面的标题、日期和正文。
3. 打开 `index.html`，在 `<ul class="posts">` 里复制一个 `<li>` 块，改链接和标题。
4. 上传/推送。
