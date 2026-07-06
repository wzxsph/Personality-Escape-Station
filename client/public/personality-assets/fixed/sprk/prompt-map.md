# Map Prompt Preview

为「人格出逃空间站 / Personality Escape Station」生成 火花排练场 的竖屏人格空间地图。
人格主题：纵火犯 / SPRK / Spark Starter。
空间氛围：场地还残留着热身音浪，灯光像刚把沉闷空气点亮。
关键词：热闹、临时聚集、能量外放、把局面烧亮
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
- sprk-mic: 失控麦克风, object, 34%, 48%
- sprk-button: 热场按钮, object, 62%, 56%
- sprk-curtain: 火花幕布, object, 74%, 42%
- sprk-host: 起哄主持人, npc, 48%, 66%
