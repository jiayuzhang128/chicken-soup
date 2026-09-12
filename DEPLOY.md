# 部署上线指南

本站是**纯静态、零构建、零后端**（HTML/CSS/JS + 图片），任何静态托管都能直接上，收藏数据存在浏览器 localStorage 里，不需要数据库。下面按「省心程度」给三条路线，以及域名购买全流程。

---

## 0. 先决定路线（30 秒版）

| 路线 | 花费 | 备案 | 国内速度 | 适合 |
|---|---|---|---|---|
| **A. Cloudflare Pages**（推荐起步） | 0 元 | 不需要 | 中等，稳定可用 | 先上线看看，10 分钟搞定 |
| **B. 云服务器**（腾讯云/阿里云轻量） | 50~120 元/月（新用户/学生更低，香港节点 ~24 元/月起） | 国内节点要备案、**香港节点免备案** | 最快 | 长期自用、以后还想部署别的 |
| **C. 对象存储静态托管**（腾讯 COS / 阿里 OSS + CDN） | 几乎 0（流量几分钱/GB） | 要备案 | 很快 | 纯静态站的最优解，但要先备案 |

> 备案 = 域名 + 服务器都在国内时，法律要求做 ICP 备案（免费，云厂商代办提交，审核约 1~2 周）。不想备案又想国内快：选**香港节点**服务器。

---

## 1. 买域名（全流程）

### 在哪买
- **腾讯云 / 阿里云（万网）**：中文界面、支付宝微信付款、和云服务器同账号管理最方便（推荐）
- **Cloudflare Registrar**：成本价续费不涨价，但需外币卡、界面英文

### 买什么
- 后缀：首选 `.com`（首年 ~55-80 元，续费 ~85 元/年）；`.cn` 首年便宜（~29-39 元）但必须实名+备案才有意义
- 名字随意，比如 `jinrijitang.com`、`tangpu.xxx`、`hewanutang.com` 之类，先查询未被注册

### 步骤（以腾讯云为例）
1. 注册腾讯云账号并**实名认证**（个人即可，微信扫码）
2. 控制台 → 域名注册 → 查询心仪域名 → 加入购物车付款
3. 域名实名认证（提交身份证，1~3 天通过）
4. 完成。域名在「我的域名」里，后面只需加一条**解析记录**指向你的托管（每条路线里会说）

---

## 2. 路线 A：Cloudflare Pages（免费，10 分钟）

1. 把本项目推到 GitHub 仓库（或直接用 Direct Upload 拖文件夹）
2. 注册 [Cloudflare](https://dash.cloudflare.com/) → Workers & Pages → Create → Pages → Connect to Git
3. 构建设置：框架预设选 **None**，构建命令留空，输出目录填 `/`
4. 部署完成得到 `xxx.pages.dev`（可先看效果）
5. 绑域名：Pages 项目 → Custom domains → 添加你的域名 → 按提示去域名注册商加一条 CNAME 记录（指向 pages.dev 地址）→ 自动签发 HTTPS 证书
6. 以后更新 = git push 自动重新部署

> 注：`pages.dev` 默认域名在国内时好时坏，绑定自己的域名后走 Cloudflare CDN，一般稳定可访问。

### GitHub Pages 也行
仓库 Settings → Pages → Deploy from branch → 选根目录。绑自定义域名同理（加 CNAME 记录 + 仓库里放 CNAME 文件）。国内访问速度一般。

---

## 3. 路线 B：云服务器 + nginx（完整可掌控）

### 3.1 买服务器
- 腾讯云/阿里云控制台 → **轻量应用服务器** → 选镜像「Ubuntu 22.04」
- 机房选香港 = 免备案立刻能用；选国内 = 先去做备案（控制台一键提交，管局审核 1~2 周，期间网站不能开 80/443）
- 新人/学生有折扣，腾讯云学生机 ~30 元/月档

### 3.2 上传网站
```bash
# 本地 Git Bash 里执行（把整个目录传上去）
scp -r "J:/win10data/AI/ChickenSoup" root@服务器IP:/var/www/chickensoup
```
（或在服务器上 `apt install -y git && git clone 你的仓库`）

### 3.3 装并配 nginx
```bash
ssh root@服务器IP
apt update && apt install -y nginx
```
写配置 `/etc/nginx/sites-available/chickensoup`：

```nginx
server {
    listen 80;
    server_name jinrijitang.com www.jinrijitang.com;   # 换成你的域名
    root /var/www/chickensoup;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript image/svg+xml;

    location / {
        try_files $uri $uri/ =404;
    }
    location ~* \.(css|js|jpg|png|svg)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

```bash
ln -s /etc/nginx/sites-available/chickensoup /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 3.4 解析域名 + HTTPS
1. 域名控制台 → 解析记录 → 添加 **A 记录**：主机记录 `@` 和 `www`，值 = 服务器公网 IP
2. 免费证书：
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d jinrijitang.com -d www.jinrijitang.com
```
自动改好 443 配置并续期。防火墙（轻量服务器控制台里）放行 80/443。

---

## 4. 路线 C：腾讯云 COS 静态托管（备案后最省心）

1. COS 控制台建存储桶（地域选离用户近的，如上海/广州）→ 权限选「公有读私有写」
2. 基础配置 → 静态网站 → 开启，索引文档 `index.html`
3. 上传 `index.html`、`assets/`、`data/`（保持目录结构）
4. 域名管理 → 添加自定义域名（需已备案）→ 自动配 CNAME + 可勾选免费证书
5. 可选：再套一层腾讯云 CDN，流量几分钱/GB

---

## 5. 上线前必读：Google Fonts 的国内问题

`index.html` 里引用了 Google Fonts（Noto Serif SC / ZCOOL XiaoWei）。**大陆用户加载 Google Fonts 会慢或失败**，页面会自动退到本地楷体/宋体兜底（已做了字体补丁，观感仍有 8 成）。三个处理选项：

1. **什么都不做**：国内用户多数时候能通（fonts.googleapis.com 有国内节点，时好时坏），失败也有兜底
2. **换镜像**：把 `<link>` 里的域名换成 `fonts.loli.net`（Google Fonts 国内镜像，用法完全一致）
3. **自托管字体**（最稳）：从 Google Fonts 下载 woff2 子集放进 `assets/fonts/`，`@font-face` 本地引用——字体文件较大（中文全量 MB 级），需按需子集化，折腾但彻底

推荐国内部署选 2，海外部署保持 1。

---

## 6. 上线检查清单

- [ ] 手机打开各页面正常（已适配 390px）
- [ ] 域名 HTTPS 小锁正常
- [ ] 换设备打开，收藏从零开始（localStorage 本来就分设备，属预期）
- [ ] 把正式网址写进 README 首行
