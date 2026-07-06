# Map Prompt Preview

为「人格出逃空间站 / Personality Escape Station」生成 深夜值班室 的竖屏人格空间地图。
人格主题：守夜人 / NOCT / Night Watcher。
空间氛围：台灯照亮了最安静的一小块桌面，真正的你在深夜才肯出现。
关键词：深夜、台灯、草稿、白天配合世界夜里做自己
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
- noct-draft: 未发送草稿, object, 30%, 54%
- noct-lamp: 值班小灯, object, 64%, 50%
- noct-window2: 月光窗, object, 74%, 30%
- noct-operator: 夜班接线员, npc, 50%, 66%
