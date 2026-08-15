# 📖 英语精读助手（English Reader）

> 把任意英语文章变成「**彩色语法标注 + 点词即查词典**」的精读工具。
> 纯前端实现，无需安装、无需服务器，双击 `index.html` 即可离线使用。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Offline%20First-blue)

---

## ✨ 功能特性

- 🎨 **四色语法标注**（内置规则引擎，无需联网）
  - 🔴 红色 = **从句**（定语从句 / 名词性从句 / 状语从句）
  - 🔵 蓝色 = **非谓语动词**（不定式 to do、动名词 doing、分词 done / doing）
  - 🟢 绿色 = **介词短语**（含 out of、because of 等复合介词）
  - 🟠 橙色 = **并列连词**（and / but / or / nor / for / yet / so）
- 🔀 **嵌套换色**：从句整体为红色，从句内部遇到非谓语 / 介词短语 / 并列词时自动换成对应颜色
- 📖 **点词查词**：点击任意单词弹出词典，显示全部中文释义（按词性分组）、音标、柯林斯 / 牛津词频、考试标签（中考 / 高考 / 雅思等）、词形变化
- 💬 **每义例句**：联网时自动为每个释义配上英文例句（含高亮），并缓存 30 天；离线时释义照常可用
- 🔊 **发音**：美音 / 英音按钮（浏览器自带语音，可离线），联网时另有真人发音
- 📚 **生词本**：一键收藏生词，可导出词表
- 🕘 **分析历史**：自动保存分析过的文章，随时重新分析
- ⬇️ **导出**：把标注版文章导出为带颜色的 HTML 文件
- 🤖 **（可选）AI 增强分析**：接入你自己的大模型接口（OpenAI 兼容），AI 标注与内置引擎结果自动合并

## 🚀 快速开始

1. 克隆或下载本仓库：
   ```bash
   git clone https://github.com/TANGJD9/english-reader.git
   ```
2. 双击打开 `index.html`（推荐 Edge 或 Chrome 浏览器）。
3. 粘贴一篇英语文章，点击「🎨 开始分析」（或点「载入示例」体验）。
4. 点击任意单词查词、点 🔊 听发音、悬停彩色片段看语法解释。

> 所有语法分析和词典都内置在网页里，可完全离线使用；只有「英文例句」和「AI 增强」需要联网。

## 🎨 标注示例

> If you keep **practicing** every day, you will make great progress **in the future**.

- 红色：`If you keep … every day`（状语从句）
- 蓝色：`practicing`（动名词，从句内自动换色）
- 绿色：`in the future`（介词短语，从句内自动换色）

## 🤖 可选：AI 增强分析

1. 点击右上角 ⚙️，开启「启用 AI 增强分析」。
2. 填写你的接口信息（以 DeepSeek 为例）：
   - 接口地址：`https://api.deepseek.com`（会自动补全 `/chat/completions`）
   - API Key：`sk-...`
   - 模型：`deepseek-chat`
3. 点「测试连接」确认可用，再点「保存」。
4. 之后「开始分析」会先用内置引擎快速标注，再请求 AI 校正并合并结果。

> 也支持 OpenAI、Moonshot、Qwen 等其它 OpenAI 兼容接口。
> ⚠️ 启用后文章内容会发送到你填写的接口，请只填写你信任的服务商。

## 📁 项目结构

```
english-reader/
├── index.html              # 主页面（入口）
├── README.md               # 本说明文档
├── LICENSE                 # MIT 许可证（含第三方组件声明）
├── css/
│   └── style.css           # 全部样式（含四色标注配色）
└── js/
    ├── compromise.min.js   # 词法分析库（第三方，MIT）
    ├── annotator.js        # 语法标注引擎（规则引擎 + 分层设计）
    ├── dict.js             # 离线英汉词典数据（源自 ECDICT，MIT，约 5.9 万常用词）
    └── app.js              # 应用逻辑（渲染 / 词典 / 发音 / 生词本 / 历史 / AI）
```

## ⚙️ 工作原理

1. **语法标注**：`annotator.js` 先调用 compromise 做词性标注（POS tagging），再按规则识别四种成分；
   从句作为「外层」，非谓语 / 介词短语 / 并列词作为「内层」，渲染时内层覆盖外层实现嵌套换色。
2. **词典**：`dict.js` 内置 ECDICT 常用词数据（释义 / 音标 / 词频 / 词形），点击单词时按词形映射查词；
   例句联网时从 Free Dictionary API 获取并缓存到 localStorage。
3. **发音**：调用浏览器 Web Speech API 朗读（`en-US` 美音 / `en-GB` 英音）。
4. **本地存储**：生词本、分析历史、例句缓存、AI 配置均存于浏览器 localStorage。

## 📚 数据来源与许可

| 组件 | 来源 | 许可证 |
|---|---|---|
| 离线词典 `js/dict.js` | [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| 词法分析 `js/compromise.min.js` | [spencermountain/compromise](https://github.com/spencermountain/compromise) | MIT |
| 英文例句 | [Free Dictionary API](https://dictionaryapi.dev) | 免费接口 |
| 发音 | 浏览器 Web Speech API | - |

本项目代码以 MIT 许可证发布，详见 [LICENSE](LICENSE)。

## ❓ 常见问题

- **例句不显示？** 例句需要联网；离线时词典释义仍可用。
- **发音没声音？** 请确认系统已安装英文语音包（Windows 通常自带 Microsoft David / Zira / Hazel）。
- **文章太长？** 单次分析上限 5 万字符。
- **生词本 / 历史存在哪？** 存在浏览器本地（localStorage），换浏览器或清除浏览器数据会清空。

## 📌 Roadmap（欢迎 PR）

- [ ] 从句类型细分配色（定语从句 / 名词性从句 / 状语从句分开）
- [ ] 生词本背诵模式（自动朗读 + 记忆曲线）
- [ ] 整篇精读笔记导出（含生词与例句）
- [ ] 深色模式
