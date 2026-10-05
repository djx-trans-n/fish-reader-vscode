# CLI Reader

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/Chenjiangwen.cli-reader?label=Marketplace&color=569cd6)](https://marketplace.visualstudio.com/items?itemName=Chenjiangwen.cli-reader)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Chenjiangwen.cli-reader?label=Installs&color=6a9955)](https://marketplace.visualstudio.com/items?itemName=Chenjiangwen.cli-reader)
[![GitHub Stars](https://img.shields.io/github/stars/Chenjiangwen/fish-reader-vscode?style=flat&logo=github&color=d4a574)](https://github.com/Chenjiangwen/fish-reader-vscode)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 一个**对话式 UI 的本地 TXT 小说阅读器**,装在 VSCode 里。把"读小说"变成"和 AI 对话"的样子:深色对话流、`> user` / `● assistant`、流式输出、代码 diff、状态栏——专注阅读,需要时一键切换到"工作态"。

纯本地、不联网、不接在线书源、不调用任何 LLM。你的书只在你自己电脑上。

<p align="center">
  <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/demo.gif" alt="CLI Reader 演示" width="800" />
</p>

---

## ✨ 功能特性

- **对话式阅读界面**:默认风格还原 Claude Code for VS Code 插件的界面(时间线圆点、带边框的用户气泡、`Edit 文件 +N -M` 工具调用),配色跟随 VSCode 主题(深色 / 浅色 / 高对比度自动适配)。
- **三款阅读风格**:`/theme` 在 Claude Code / Codex / DeepSeek TUI 三种观感之间切换,配色、字体、密度整体变化。
- **阅读字号可调**:`Ctrl/Cmd` + `+` / `-` 实时缩放正文(codex / deepseek 风格的输入框里还有 `A-` / `A+` 按钮),`Ctrl/Cmd+0` 复位到风格默认字号,设置随会话保存。
- **整章输出 + 智能分页**:一条命令输出一整章;识别不到章节标题的书会按字数自动分页。
- **智能合并细碎段落**:对话体小说"一行一段"的碎段落会自动合并成可读的整块。
- **章节解析**:支持 `第X章/节/卷/回/篇`、`Chapter N`、`楔子`、`序章`、`番外`,正则可自定义。
- **多编码支持**:自动识别 UTF-8 / GBK / GB18030。
- **斜杠命令系统**:输入 `/` 唤起命令面板,模糊匹配、↑↓ 选择、Tab/Enter 补全。
- **命令历史**:输入框按 ↑ / ↓ 回溯历史命令,一个 ↑ + Enter 即可重复翻页。
- **书库 / 进度管理**:侧边栏列出所有读过的书(书名 + 进度条),点击即恢复上次位置;进度自动持久化,重启续读。
- **书签 / 搜索 / 跳转**:全文搜索、按章跳转、命名书签。
- **工作态切换(Boss Mode)**:一键(或被动触发)把界面切成"看似在用 AI 写代码"的编码对话,内容根据你当前打开的真实代码文件生成。

---

## 🚀 快速开始

1. 安装后,点左侧活动栏的 **◆ CLI Reader** 图标,打开侧边栏。
2. 点顶部 **＋ 新建会话**,会在编辑器区打开一个阅读面板(tab)。
3. 在输入框输入 `/init <文件路径>` 关联一本书(也可以点输入框左下角的 **`+`** 选择本地文件,支持 txt / epub / fb2)。
4. 输入 `/next`(或按 ↑ 调出再回车)开始一章一章地读。

之后这本书会出现在侧边栏书库里,下次点一下就能从上次位置接着读。

---

## 💬 命令列表

输入 `/` 会弹出命令面板。命令支持中文名与英文别名,效果一致。

| 命令 | 别名 | 说明 |
|---|---|---|
| `/init <路径>` | `/open` `/load` | 关联一本本地 txt 文件 |
| `/toc` | `/目录` | 查看章节列表(可点击跳转) |
| `/next` | `/n` `/下一页` `/下一章` | 下一章(整章输出) |
| `/prev` | `/p` `/上一页` `/上一章` | 上一章 |
| `/jump <章节号>` | `/跳转` `/goto` | 跳到第 N 章 |
| `/theme [风格]` | `/主题` | 切换阅读风格:`claude` / `codex` / `deepseek`,不带参数则循环切换 |
| `/search <关键词>` | `/搜索` `/find` | 全文搜索(结果可点击跳转) |
| `/bookmark [add 名称\|list\|jump 序号]` | `/书签` `/bm` | 书签:添加 / 列表 / 跳转 |
| `/history [N]` | `/历史` `/switch` | 切换最近读过的书 |
| `/settings` | `/设置` `/config` | 打开配置面板 |
| `/boss` | `/老板` | 手动进入工作态 |
| `/resume` | `/恢复` | 退出工作态,回到阅读 |
| `/help` | `/帮助` `/?` | 查看全部命令 |

**快捷键**(均可在 VSCode 键盘快捷方式里自定义):

| 快捷键 | 命令 |
|---|---|
| `Cmd/Ctrl+Shift+B` | 切换工作态(开 / 关) |
| `Alt+N` | 下一章 |
| `Alt+P` | 上一章 |
| `Cmd/Ctrl` + `+` / `-` | 放大 / 缩小阅读字号 |
| `Cmd/Ctrl+0` | 阅读字号复位 |

---

## 🎨 阅读风格(`/theme`)

三款风格分别对照 Claude Code、Codex、DeepSeek TUI 的真实观感,配色、正文字体、行距与信息密度都不同。输入 `/theme claude` / `/theme codex` / `/theme deepseek` 指定,或直接 `/theme` 循环切换;选择随会话保存。

| 风格 | 观感 |
|---|---|
| `claude`(默认) | 还原 Claude Code for VS Code 插件:跟随编辑器主题配色、13px 无衬线正文、时间线圆点、`Edit` 工具调用 + 行号 diff、暖橙发送按钮 |
| `codex` | 纯黑底、等宽正文、近乎不用强调色,方角细边的原生终端感 |
| `deepseek` | 深靛底、等宽正文、蓝紫主色 + 琥珀 / 绿语义色,信息密度更高 |

下面每款风格各两张:左边**阅读态**(正文 + 假 diff,标题栏带书名),右边**工作态**(Boss Mode 编码对话,书名隐藏)。风格是全局的,两种状态用同一套配色。

### `claude` — 还原 Claude Code for VS Code 插件,配色跟随编辑器主题

| 阅读态 | 工作态(Boss Mode) |
|---|---|
| <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-claude-b.jpg" alt="claude 风格 · 阅读态" width="400" /> | <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-claude-a.jpg" alt="claude 风格 · 工作态" width="400" /> |

### `codex` — 纯黑底、等宽正文、原生终端感

| 阅读态 | 工作态(Boss Mode) |
|---|---|
| <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-codex-b.jpg" alt="codex 风格 · 阅读态" width="400" /> | <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-codex-a.jpg" alt="codex 风格 · 工作态" width="400" /> |

### `deepseek` — 深靛底、等宽正文、蓝紫主色 + 琥珀 / 绿语义色

| 阅读态 | 工作态(Boss Mode) |
|---|---|
| <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-deepseek-b.jpg" alt="deepseek 风格 · 阅读态" width="400" /> | <img src="https://raw.githubusercontent.com/Chenjiangwen/fish-reader-vscode/main/media/theme-deepseek-a.jpg" alt="deepseek 风格 · 工作态" width="400" /> |

---

## 📖 阅读体验

- `/next` 一次输出**一整章**,光标(滚动条)固定在这一页的开头,你自己往下滚着读,节奏自己掌握。
- 章节之间穿插的 `Edit xxx.ts` / `Read` / `Grep` / `Bash` 工具调用(codex / deepseek 风格里是 `● assistant · edited xxx.ts`、`$ npm test` 等)+ 代码 diff / 命令输出是伪装效果,可在配置里关闭或调频率。
- 觉得字小 / 字大,用 `Ctrl/Cmd` + `+` / `-` 直接调(codex / deepseek 风格也可以点输入框左下角的 `A-` `A+`);`Ctrl/Cmd+0` 回到默认。
- 换个观感用 `/theme`,详见上面的[阅读风格](#-阅读风格theme)。
- 进度按字符级保存,关掉 VSCode 重开也能接着读。

---

## 🕶 工作态切换(Boss Mode)

一键把面板从"小说"瞬间切成"看似真实的编码对话"——标题变成伪造的提问(和真实 Claude Code 会话一样)、隐藏书名、状态延续,内容根据你**当前打开的代码文件**(类名 / 函数名 / import / 真实代码片段)即时生成。

**进入方式**(被动触发可在设置里勾选):

| 方式 | 说明 |
|---|---|
| 快捷键 `Cmd/Ctrl+Shift+B` | 始终可用 |
| 输入框右下角 `</>` 按钮 / `/boss` | 始终可用 |
| 窗口失焦(`blur`) | 切到别的应用 N 秒后(可配,可关) |
| 鼠标离开面板(`mouseLeave`) | 鼠标移出面板 N 秒后(可配,可关) |
| 切到代码 tab(`editorFocus`) | 点开代码编辑器时(可配,默认关) |

三款风格下工作态的样子见上面[阅读风格](#-阅读风格theme)一节右列的截图。

**退出方式**:为了安全,**默认只能手动退出**——快捷键 / `</>` 按钮 / `/resume`。工作态下命令面板只放行 `/resume`,其它命令隐藏,绝不会误操作露出小说。(若想"鼠标移回 / 窗口重新聚焦自动退出",把 `bossMode.autoExit` 设为 `true`。)

---

## ⚙️ 配置项(`fishReader.*`)

在 VSCode 设置里搜 `fishReader`(配置项前缀,为兼容旧版本保持不变)。

| 配置 | 默认 | 说明 |
|---|---|---|
| `charsPerPage` | `300` | 每页字数(仅用于页码显示) |
| `encoding` | `auto` | 文件编码:auto / utf-8 / gbk / gb18030 |
| `chapterRegex` | (见设置) | 章节标题匹配正则 |
| `maxChapterChars` | `3000` | 超长章节 / 无标题书的虚拟分页长度,`0` 关闭 |
| `mergeParagraphs` | `true` | 智能合并细碎段落 |
| `paragraphTargetChars` | `120` | 合并段落的目标字数 |
| `fakeThinkingSpeed` | `normal` | 流式速度:slow / normal / fast / off |
| `fakeDiff.enabled` | `true` | 是否在段落间插入假 diff |
| `fakeDiff.frequency` | `0.7` | 假 diff 出现概率 0~1 |
| `fakeDiff.language` | `auto` | 假 diff 语言,auto 跟随 workspace |
| `fakeDiff.snippetSource` | `workspace` | diff 文件名来源:workspace / builtin |
| `bossMode.triggers` | `["blur","mouseLeave"]` | 启用哪些被动触发:blur / mouseLeave / editorFocus |
| `bossMode.mouseLeaveDelay` | `1000` | 鼠标离开多久触发(ms) |
| `bossMode.blurDelay` | `5000` | 窗口失焦多久触发(ms) |
| `bossMode.autoExit` | `false` | 是否允许被动方式自动退出工作态 |
| `bossMode.readActiveTab` | `true` | 读当前 tab 生成伪装内容 |
| `bossMode.scanWorkspace` | `true` | 启动时扫描 workspace 真实文件名 |

---

## 🧩 两种打开方式

- **侧边栏(书库列表)**:活动栏 ◆ 图标 → 新建会话 / 搜索 / 书籍列表。
- **编辑器 tab(阅读面板)**:像普通编辑器标签一样,可拖到任意分组、左右分屏、独立窗口。

---

## 🛠 本地开发 / 构建

```bash
npm install      # 安装依赖
npm run build    # 产出 dist/(extension.js / webview.js / library.js / styles.css)
npm run watch    # 开发时增量构建
```

在 VSCode 里打开本项目按 **F5** 启动扩展开发宿主调试。

---

## 🙏 致谢

本项目基于 [wuuhw/fish-reader-vscode](https://github.com/wuuhw/fish-reader-vscode) 二次开发,感谢原作者的开源工作。

---

## 📄 License

MIT
