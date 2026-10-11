# GAPS 独立站 · 国内上线说明

测评逻辑都在浏览器里。V1 只托管静态文件即可独立提供服务。需要存结果时再开 V2。

不要把 GitHub Pages 当国内主入口（访问不稳定）。请用已备案域名 + 国内 CDN/OSS。

## V1 静态上线（先做）

需要放上去的文件：

- `index.html`
- `style.css`
- `app.js`
- `data.js`
- `favicon.svg`
- `robots.txt`

步骤：

1. 在国内注册商购买域名，提交 ICP 备案（周期通常最长）。
2. 备案通过后，打开 `index.html`，把页脚 `京ICP备XXXXXXXX号-1` 换成真实备案号。
3. 托管任选其一：
   - 阿里云 OSS 或腾讯云 COS：开启「静态网站」，默认首页 `index.html`
   - 轻量服务器：Nginx 根目录指向本项目，参考 `nginx.conf.example`
4. 给域名配 HTTPS（证书可在云厂商免费申请），前面加国内 CDN。
5. 用手机 4G、微信内置浏览器、电脑 Chrome 各答完 16 题验收。

V1 不算题、不存数据。关掉页面结果即消失。

## V2 交卷接口（可选）

只有当你要统计「测了多少人、哪种类型多」时再开。

本机试跑（需安装 Python 3）：

```
python server/app.py
```

默认监听 `127.0.0.1:8001`。健康检查：浏览器打开 `http://127.0.0.1:8001/api/health`

正式环境：Nginx 把 `/api/` 反代到 `8001`，静态文件仍由 Nginx 提供。交卷地址与页面同域：`https://你的域名/api/results`

- 前端出结果时会 `POST` 类型和四维分，**不传姓名**
- 请求失败不影响出画像
- 数据存在 `server/results.db`（SQLite），请定期备份该文件
- 接口带简单按 IP 限流，防止被刷

## V2.1 Kimi 个性化建议（可选）

用 Moonshot / Kimi 生成结果页的「适合方向」「可以这样补」。**API Key 只放服务器环境变量，不要写进前端。**

PowerShell 启动示例：

```powershell
$env:MOONSHOT_API_KEY = "sk-xxxx"
$env:MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1"
$env:MOONSHOT_MODEL = "moonshot-v1-8k"
cd server
python app.py
```

- `GET /api/health` 会返回 `kimiConfigured: true/false`
- `POST /api/advice`：后端代调 Kimi；失败时前端仍用本地零件拼装
- 本地用 `http://127.0.0.1:5500` 预览时，前端会自动请求 `http://127.0.0.1:8001`（后端仅对 5500/5501 开 CORS）
- 需要同时开静态页（5500）和 `python server/app.py`（8001）；没有 Key 时 `/api/advice` 返回 503，页面仍显示本地拼装文案
- 正式环境请用 Nginx 同域反代 `/api/`（见 `nginx.conf.example`），前端会走相对路径 `/api/advice`
- `base_url` / `model` 以 [Kimi 开放平台](https://platform.kimi.ai/) 控制台文档为准

## 安全简记

- 题库是公开的，真正敏感的是 V2 里的测评结果与 API Key
- 强制 HTTPS；页脚保留备案号链接
- 国内统计用百度统计或友盟，不要默认上 Google Analytics
- 永远不要把 `MOONSHOT_API_KEY` 提交到 Git
