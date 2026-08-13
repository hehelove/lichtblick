# Lichtblick 特性集成计划

> 基于 Foxglove v2.50-v2.57 最新特性分析，结合当前项目需要制定。

---

## Phase 0：基础设施准备（当前）

| # | 任务 | 状态 |
|---|------|------|
| 0.1 | 安装依赖 (`yarn install`) | ✅ |
| 0.2 | 跑 Biome 格式化 (`yarn lint`) | ✅ |
| 0.3 | 验证 pre-commit hook | ⬜ |
| 0.4 | 基础类型检查 (`tsc --noEmit`) | ✅ |

---

## Phase 1：低挂果实 + 核心特性（1-2 天）

### 1A. 消息路径函数 @ypr/@yrp

| # | 任务 | 文件 |
|---|------|------|
| 1A.1 | 扩展 `quatToEuler` 支持 ZYX/ZXY 顺序 | `util/quatToEuler.ts` |
| 1A.2 | 在 `mathFunctions` 中注册 `ypr`/`yrp` | `Plot/utils/mathFunctions.ts` |
| 1A.3 | 4 个 builder 中处理四元数对象输入 | `builders/*.ts` |
| 1A.4 | 添加 `@yaw`/`@pitch`/`@roll` 单独分量函数 | `Plot/utils/mathFunctions.ts` |
| 1A.5 | 单元测试 | `*.test.ts` |

状态：✅ 已完成

### 1B. Plot 副 Y 轴

| # | 任务 | 文件 |
|---|------|------|
| 1B.1 | Config 类型扩展（PlotPath.yAxisID + PlotConfig 副轴字段） | `Plot/utils/config.ts` |
| 1B.2 | 默认值更新 | `Plot/constants.ts` |
| 1B.3 | Settings UI 加 Axis 选择 + 副轴设置组 | `buildSettingsTree.ts` |
| 1B.4 | Action handler 处理新字段 | `usePlotPanelSettings.ts` |
| 1B.5 | UpdateAction 扩展 | `Plot/types.ts` |
| 1B.6 | PlotCoordinator 透传副轴配置 | `PlotCoordinator.ts` |
| 1B.7 | getChartOptions 加 y1 scale | `getChartOptions.ts` |
| 1B.8 | ChartRenderer 处理副轴配置 | `ChartRenderer.ts` |

状态：✅ 已完成

### 1C. 其他低挂果实

| # | 任务 | 说明 |
|---|------|------|
| 1C.1 | 消息路径 `.@norm` 函数 | 数组标量归一化 |
| 1C.2 | Panel 设置展开状态持久化 | `localStorage` 存设置树展开状态 |
| 1C.3 | Plot 图例四角定位 | TopLeft/TopRight/BottomLeft/BottomRight |

状态：✅ 已完成

---

## Phase 2：Plot 动态系列（2-3 天）

| # | 任务 | 文件 |
|---|------|------|
| 2.1 | 共享工具 `DynamicSeriesResolver` | 新建 `Plot/utils/dynamicSeries.ts` |
| 2.2 | Config 扩展（labelField/valueField） | `Plot/utils/config.ts` |
| 2.3 | SeriesItem 扩展（compositeKey + subLabel） | `Plot/builders/IDatasetsBuilder.ts` |
| 2.4 | Coordinator 支持动态 path 检测 | `PlotCoordinator.ts` |
| 2.5 | TimestampDatasetsBuilder 动态展开 | `builders/TimestampDatasetsBuilder.ts` |
| 2.6 | IndexDatasetsBuilder 动态展开 | `builders/IndexDatasetsBuilder.ts` |
| 2.7 | CustomDatasetsBuilder 动态展开 | `builders/CustomDatasetsBuilder.ts` |
| 2.8 | CurrentCustomDatasetsBuilder 动态展开 | `builders/CurrentCustomDatasetsBuilder.ts` |
| 2.9 | 图例支持子系列显隐 | `PlotLegend.tsx` |
| 2.10 | 颜色分配（Label 哈希 + 用户覆盖） | `dynamicSeries.ts` + config |
| 2.11 | 单元测试 + 集成测试 | `*.test.ts` |

状态：✅ 已完成

---

## Phase 3：State Transitions 动态系列

| # | 任务 | 文件 |
|---|------|------|
| 3.1 | `datasetContainsArray()` 改为支持动态展开 | `StateTransitions/shared.ts` |
| 3.2 | `useStateTransitionsData` 支持子行展开 | `hooks/useStateTransitionsData.ts` |
| 3.3 | `messagesToDataset` 支持 label/value 数组 | `messagesToDataset.ts` |
| 3.4 | Settings UI（labelField/valueField） | `hooks/usePanelSettings.ts` |
| 3.5 | 拖拽重排序（复用 Plot 已有实现） | `index.tsx` |

状态：✅ 已完成（3.5 已由上游实现，其余本分支完成）

---

## Phase 4：3D 逐话题 sync

| # | 任务 | 文件 |
|---|------|------|
| 4.1 | BaseSettings 加 `synchronize` | `settings.ts` |
| 4.2 | RendererConfig 加 `topicsSynchronize` | `IRenderer.ts` |
| 4.3 | 新建 SyncManager（精确时间戳匹配，最多缓存 250 个时间戳） | 新建 `SyncManager.ts` |
| 4.4 | 订阅构建传播 synchronize 标志 | `ThreeDeeRender.tsx` |
| 4.5 | 队列处理路由到 SyncManager | `Renderer.ts` |
| 4.6 | 每个场景扩展 settingsNodes 加 synchronize 字段 | `Markers.ts`, `PointClouds.ts` 等 |
| 4.7 | 全局开关（SceneSettings 或 baseSettingsTree） | `SceneSettings.ts` |

状态：✅ 已完成

---

## 后续可选特性

| 特性 | 说明 |
|------|------|
| Audio Panel | 支持 CompressedAudio（Opus/AAC-LC） |
| MCAP 元数据/附件侧边栏 | 左侧 Metadata / Attachments tab |
| Raw Messages 逐条翻页 | v2.57.0，多条消息共享最新时间戳时翻页 |
| 3D 测量吸附对齐 | Alt/Option 吸附到场景物体顶点 |
| 3D 压缩点云 | Draco 压缩的 CompressedPointCloud |
| Plot 悬停预览时间 | 悬停点时调用 setPreviewTime |
| 用户脚本 eulerToQuaternion | 内置四元数辅助函数 |
| Map 话题重排 | 图层和话题拖拽排序 |

---

## 设计决策记录

### 动态系列

| 决策项 | 结论 |
|--------|------|
| 展开方式 | 运行时展开（1 config path → N 子系列） |
| 索引方案 | 复合字符串 key `"${configIndex}:${subLabel}"` |
| 颜色分配 | Label 哈希 + 用户可覆盖 |
| 配置字段 | `labelField?: string`（默认 `"label"`），`valueField?: string`（默认 `"value"`） |
| 实施范围 | 先 Plot，ST 第二期 |

### 副 Y 轴

| 决策项 | 结论 |
|--------|------|
| 技术方案 | Chart.js 原生 `yAxisID` + 多 scales |
| 每系列可选 | `yAxisID: "y"` (左) 或 `"y1"` (右) |
| 副轴配置 | `minYValueRight`, `maxYValueRight`, `yAxisLabelRight`, `showYAxisLabelsRight` |

### @ypr/@yrp

| 决策项 | 结论 |
|--------|------|
| 签名 | `(value: number \| Record) => number`（扩展 MathFunction） |
| @ypr | ZYX 顺序 → 返回 yaw |
| @yrp | ZXY 顺序 → 返回 yaw |
| 分量函数 | 后续可加 `@yaw`/`@pitch`/`@roll` 单独返回 |
