# KeyHub Chrome 商店上架草稿

此目录包含 KeyHub 扩展的上架文案、数据声明与审核指引草稿。当前是待提交材料，不代表已经上传、审核通过或公开发布。

本次只调整文档显示品牌：OpenKeylet → KeyHub，不修改扩展固定 ID、配对令牌、桥接协议、存储键或权限。版本仍为 **v0.16.1**，不宣称新发行包已发布。当前项目仓库为 https://github.com/hhf666feng/KeyHub，支持与下载入口使用 KeyHub 项目地址；使用前须核对现有发行包的兼容性。迁移与能力保持见[主说明](../../README.zh-CN.md#迁移与能力保持)。

## 材料清单

| 材料 | 文件 |
| --- | --- |
| 英文商店文案 | [listing.en.md](listing.en.md) |
| 中文商店文案 | [listing.zh-CN.md](listing.zh-CN.md) |
| 单一用途、权限理由、隐私字段填写指南 | [privacy-practices.md](privacy-practices.md) |
| 审核测试指引 | [reviewer-instructions.md](reviewer-instructions.md) |
| 代码与权限审查、验证记录 | 待补充；当前目录没有 `audit.md`，不作为已验证证据 |
| 英文隐私政策 | [PRIVACY.md](../../PRIVACY.md) |
| 中文隐私政策 | [PRIVACY.zh-CN.md](../../PRIVACY.zh-CN.md) |
| 随包离线隐私说明 | [privacy.html](../../browser-extension/privacy.html) |
| 图标、宣传图、功能截图 | 待按最终构建补充 `assets/`，不是本次文档改名的交付物 |

## 提交前需要确定

- 发布者显示名称和已验证的公开联系邮箱：由账号所有者填写，材料不虚构个人资料。
- 在开发者后台完成注册、两步验证及真实的 Trader / Non-Trader 声明。
- 把隐私政策发布到可公开访问、无需登录的页面，并把实际生效网址填入 Privacy policy URL。仓库文件在提交并公开前不能当作已上线网址。
- 提供与当前扩展匹配的桌面应用发行包。现有 `releases/latest` 只是下载入口，必须核对线上版本是否包含本次密码库和桥接功能。
- 未来首次提交时，只上传 ZIP 为草稿并核对商店 ID、公钥与 `src-tauri/src/browser.rs` 的 `EXTENSION_ORIGIN`、开发用 manifest `key` 及集成测试 ID。本次改名保持既有固定身份；若不匹配，停止发布，另行审查兼容方案，不因显示品牌变化替换身份或改成接受任意扩展 Origin。
- 用实际商店安装的版本验证配对、权限、网站访问设置和升级。开发者模式测试不能替代这一步。
- 以最终发布行为核对隐私字段、功能范围与图片；取得真实账号资料后填入后台。当前商店文案明确要求桌面应用，不宣称独立运行。

## 生成上传包

在 Windows PowerShell 中先加载项目环境，再运行：

```powershell
& 'C:\Users\malou\Documents\myenv\config\Use-ProjectEnvironment.ps1' -ProjectPath (Get-Location).Path -Quiet
& .\scripts\package-chrome-store.ps1
```

ZIP 与校验值输出到 `dist/chrome-web-store/`。临时打包目录必须在 `MYENV_ROOT` 内。脚本只包含扩展运行文件，不包含桌面 EXE、测试密码库、源码仓库元数据或上架文档。它删除上传副本中的开发用 `key`，保留源码中的固定开发 ID；正式 ID 仍须按上面的流程确认。

重新生成截图和宣传图：

```powershell
& 'C:\Users\malou\Documents\myenv\config\Use-ProjectEnvironment.ps1' -ProjectPath (Get-Location).Path -Quiet
cargo build --manifest-path src-tauri/Cargo.toml --example browser_fixture
node scripts/prepare-store-assets.mjs
```

截图使用真实扩展和真实 Rust 测试后端，账号与网站均为虚构示例。临时浏览器配置和密码库在项目环境的临时目录中；不会读取个人 Chrome 配置或真实密码库。

## 发布顺序

以下为未来发布流程，不是完成记录：完成身份与资料 → 上传草稿并核对固定扩展身份 → 确认兼容桌面包及隐私政策已可用 → 用商店安装包测试 → 提交审核 → 审核通过后发布。

本次文档改名不增加版本号；未来实际提交更新时再按商店要求处理版本。后续可以另行接入 Chrome Web Store V2 API 自动上传和送审，审核本身仍由 Google 完成。

## 官方参考

核对日期：2026-10-20。

- [发布流程](https://developer.chrome.com/docs/webstore/publish)
- [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [开发者政策](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [图片要求](https://developer.chrome.com/docs/webstore/images)
- [固定扩展 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [审核流程](https://developer.chrome.com/docs/webstore/review-process)
