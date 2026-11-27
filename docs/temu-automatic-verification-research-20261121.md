# Temu 自动选品与验证码方案核查

核查日期：2026-11-21。用户要求系统自动处理验证后继续采集；上一版人工处理验证不满足最终目标。本文件是公开文档、源码与本机连接核查结论，不代表自动验证已实现或实测成功。

## 推荐方向

保留当前“绑定 Chrome 搜关键词 → 打开商品 → 店小秘插件采集 → 原账号采集箱回读”流程，补独立的自动验证处理组件。普通拼图评估云码和本地识别；Temu 弧线、多图或点选类型使用与实际挑战匹配的专用适配器。仅更换商品链接爬虫不能解决插件打开详情页时的验证。

当前工作台已经具备关键词搜索、读取可见商品链接、商品ID去重和入箱回读。相较重写整套爬虫，最小改动是补上验证处理，再扩展搜索翻页。

## 开源项目

| 项目 | 本次核验 | 用途与限制 |
| --- | --- | --- |
| [omkarcloud/temu-scraper](https://github.com/omkarcloud/temu-scraper) | MIT；最新提交39e0908168975598e122236cea19233e9f98eba6，2026-11-20；有本机Chrome、搜索、解析源码，无第三方服务API key依赖 | 可作为关键词找链接与分页的候选参考；显式覆盖US/GB/CA。源码遇验证码抛BoxRefused，没有滑块求解器。本次未安装或运行 |
| [sml2h3/ddddocr](https://github.com/sml2h3/ddddocr) | MIT；支持本地slide_match、slide_comparison，依赖OpenCV等 | 可做普通拼图位置识别，不能据此证明Temu整套验证通过；弧线、旋转、多图挑战需额外适配 |
| [littleyellowbicycle/temu-scraper](https://github.com/littleyellowbicycle/temu-scraper) | 最后提交2026-05-20；未找到LICENSE；主要处理已知商品URL详情 | 不作为优先接入方案，缺关键词发现及验证码处理 |
| [yancyfeng999-star/cross-border-ecommerce-scraper](https://github.com/yancyfeng999-star/cross-border-ecommerce-scraper) | 2026-04-12初始提交；未找到LICENSE；Temu为通用Playwright/CSS适配骨架 | 有关键词取链接，但没有验证码求解，当前工作台无须为此重写 |
| [fanchenhao/temu-captcha-solver](https://github.com/fanchenhao/temu-captcha-solver) | 2024-10-03最后推送；未找到LICENSE；README说明是SadCaptcha API客户端 | 不能当作完整免费的本地识别引擎。文档所引原gbiz123/temu-captcha-solver仓库本次GitHub API返回404 |

omkarcloud关键证据：[固定版本浏览器代码](https://github.com/omkarcloud/temu-scraper/blob/39e0908168975598e122236cea19233e9f98eba6/browser_client.py)、[搜索实现](https://github.com/omkarcloud/temu-scraper/blob/39e0908168975598e122236cea19233e9f98eba6/temu/api.py)、[解析器](https://github.com/omkarcloud/temu-scraper/blob/39e0908168975598e122236cea19233e9f98eba6/temu/parsers.py)、[MIT许可](https://github.com/omkarcloud/temu-scraper/blob/39e0908168975598e122236cea19233e9f98eba6/LICENSE)。近期提交和README展示的样例均不等于当前用户环境的实测成功。

## 云码与专用服务

云码确认指重庆建服宝旗下的[jfbym.com](https://www.jfbym.com/about.html)。

| 接口或服务 | 公开能力 | 已核实的边界 |
| --- | --- | --- |
| [云码单图滑块20225](https://jfbym.com/test/199.html) | 一张图，返回滑块到缺口的像素距离，或缺口横坐标；页面标价0.008元/次 | 文档明确识别结果不能直接当实际滑动距离。未找到Temu专用成功率说明 |
| [云码双图滑块20111](https://jfbym.com/test/78.html) | 背景、滑块两张原图，返回缺口坐标；页面标价0.01元/次 | 同样需要映射到当前页面实际滑动关系 |
| [SadCaptcha官方文档](https://www.sadcaptcha.com/api/v1/swagger-ui/index.html) | 明确列出Temu Arced Slide、Swap Two、3x3等类型 | 弧线类型需要图像和运动轨迹；属于商业服务能力，不等于普通静态缺口识别。本次未调用，未验证通过率 |
| [2Captcha Temu接口](https://2captcha.com/api-docs/temu-captcha) | Temu图像任务；官方说明覆盖Line/Icon并返回坐标 | 需在浏览器执行对应动作；不能当作所有Temu滑块都支持。[官方说明](https://2captcha.com/h/how-to-solve-temu-captcha-via-api-a-guide-to-working-with-coordinates) |

云码只支持3小时内报错；本次未查到超时免扣、失败自动退款或重复请求幂等保证。两种公开单价对应1000次识别8元或10元，这不是1000件商品的保证成本。遇验证频率、失败和重试都会影响实际单品成本。

云码示例端点写为HTTP，实际接入前须确认官方可用HTTPS路径，再从本机加密配置读取Token。本次没有获取或提交Token，没有上传验证码图，没有购买或调用付费识别。

## 接入规格

1. 在搜索页、商品详情页、插件点击前统一检查当前挑战。
2. 提取仅包含验证码的图片和几何信息，识别类型后选已适配的识别器。不能把所有挑战都按普通横向缺口处理。
3. 付费识别前记录图像指纹、任务ID、请求意图和预算；返回后记录服务回执。密钥不进入任务记录。
4. 将识别结果映射到原页面，执行对应动作；读取页面确认验证消失，同时目标关键词或商品ID仍一致，才继续采集。
5. 自动处理状态为solved、unsupported、failed、unknown。未知请求结果不盲目重复扣费；每任务设置尝试上限和预算上限。异常暂停属于最后兜底，正常路径应自动完成。
6. 继续复用商品采集的提交前持久化、结果回读、跨任务去重，避免解码后重放已经提交的商品。

## 首轮实测与验收

先获取实际遇到的Temu挑战类型及原始图片/页面几何，验证普通拼图还是弧线、多图类型；再用同一绑定浏览器完成“自动识别 → 自动操作 → 服务器放行”。记录首次通过率、总通过率、耗时、调用次数与费用。

验证成功后再执行小批次“关键词 → 商品链接 → 自动验证 → 店小秘插件 → 原账号采集箱确认”，包含搜索页与详情页验证。必须分别记录“识别服务返回成功”“Temu页面实际通过”“商品成功入箱”，不能混为一项。

## 连接诊断修正

上一轮BrowserSkill在52800端口启动失败，不能推断工作台运行时CDP失败。工作台走scripts/lib/chrome-cdp.mjs配置的debugPort，与BrowserSkill不同。本轮只读访问绑定端口9222的/json/version成功，返回Chrome/157.0.8103.79、协议1.3。只证明调试端点可达，未执行真实验证码交互或商品采集。

当前业务代码仍为人工暂停版本；本轮新增本调研文件，没有将未经实际挑战验证的通用解码代码直接启用到运行任务。
