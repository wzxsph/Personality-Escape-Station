# Map Prompt Preview

为「人格出逃空间站 / Personality Escape Station」生成 现实质检局 的竖屏人格空间地图。
人格主题：草台班子监察员 / JANK / Reality QA。
空间氛围：整面白板写满现实漏洞，空气里全是“这个流程居然能上线”的清醒吐槽。
关键词：系统质检、流程漏洞、现实 debug、清醒吐槽
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
- jank-board: Bug 白板, object, 32%, 50%
- jank-magnifier: 放大镜屏, object, 68%, 52%
- jank-box: 投诉工单箱, object, 52%, 32%
- jank-inspector: 质检值班员, npc, 50%, 66%
