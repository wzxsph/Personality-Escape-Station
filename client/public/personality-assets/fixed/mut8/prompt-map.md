# Map Prompt Preview

为「人格出逃空间站 / Personality Escape Station」生成 过载变形舱 的竖屏人格空间地图。
人格主题：变异体 / MUT8 / Overload Shifter。
空间氛围：舱壁轻微震动，提醒你这里允许压力过载后换一种形态继续活。
关键词：过载、形态切换、警报、临界值之后的自救
画面必须是 9:16 竖屏、俯视游戏地图、无文字、无角色、主路径宽而连续，互动点位于安全区。
地图生成会附带固定导航模板：浅色区域就是最终可行走地面，深色区域就是墙体/家具/不可走背景。请让最终地图的地面形状服从模板，不要让家具盖住模板地面。
互动 Agent 和重点道具会作为独立 sprite 叠加；地图只需要自然的地面留白、家具旁空位或地毯边缘，不要画出 Agent/道具本体。
绝对不要画 dashed boxes、dashed circles、selection outlines、target reticles、UI markers、coordinate dots、placeholder frames、bounding boxes、虚线框、虚线圆、十字准星、坐标点、图例或编辑器选区。

## Navigation Template Contract
- map/navigation-template.png is generated before image generation.
- Light connected floor must become the visible walkable floor/carpet/platform in the final map.
- Dark areas must remain walls, furniture, soft decor, shadow, or blocked background.
- Do not draw visible markers, circles, boxes, labels, coordinates, or debug overlays.

## Hotspots
- mut8-mirror: 故障镜子, object, 30%, 50%
- mut8-switch: 二形态开关, object, 64%, 52%
- mut8-core: 冷却核心, object, 50%, 32%
- mut8-tech: 舱内技师, npc, 52%, 66%
