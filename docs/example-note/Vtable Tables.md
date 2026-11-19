Tables drawn with the [Vtable](https://community.obsidian.md/plugins/vtable) plugin, exported with **Vtable tables** switched on. Each block below is the JSON Vtable stores in the note.

## Merged cells

The block from the original request: a title row and a subtitle row merged across both columns.

```vtable
{"rows":[[{"t":"Example merged cell 1","rs":1,"cs":2,"a":"c"},{"t":"","rs":0,"cs":0}],[{"t":"Example merged cell 2","rs":1,"cs":2,"a":"c"},{"t":"","rs":0,"cs":0}],[{"t":"Example cell left 1","rs":1,"cs":1,"a":"c"},{"t":"Example cell right 1","rs":1,"cs":1,"a":"c"}],[{"t":"Example cell left 2","rs":1,"cs":1,"a":"c"},{"t":"Example cell right 2","rs":1,"cs":1,"a":"c"}],[{"t":"Example cell left 3","rs":1,"cs":1,"a":"c"},{"t":"Example cell right 3","rs":1,"cs":1,"a":"c"}]],"colWidths":[621,120]}
```

## Row spans, alignment and colours

A cell merged down several rows, vertical alignment, and cell backgrounds.

```vtable
{"rows":[[{"t":"Team"},{"t":"Owner"},{"t":"Task"},{"t":"Status","a":"c"}],[{"t":"**Platform**","rs":3,"va":"m"},{"t":"Ana"},{"t":"Row spans in the layout engine"},{"t":"Done","a":"c","bg":"#dafbe1"}],[{"t":"","rs":0,"cs":0},{"t":"Ben"},{"t":"HTML tables in markdown"},{"t":"Done","a":"c","bg":"#dafbe1"}],[{"t":"","rs":0,"cs":0},{"t":"Cy"},{"t":"Page splitting of spanned rows"},{"t":"Review","a":"c","bg":"#fff8c5"}],[{"t":"**Plugins**","rs":2,"va":"m"},{"t":"Dee"},{"t":"Vtable adapter"},{"t":"Done","a":"c","bg":"#dafbe1"}],[{"t":"","rs":0,"cs":0},{"t":"Eli"},{"t":"Charts as images<br>_not started_"},{"t":"Blocked","a":"c","bg":"#ffebe9"}]]}
```

## Formulas

Vtable stores only the formula, so the plugin works out each value before the export.

```vtable
{"rows":[[{"t":"Item"},{"t":"Qty","a":"r"},{"t":"Unit price","a":"r"},{"t":"Line total","a":"r"}],[{"t":"Design review"},{"t":"2","a":"r"},{"t":"200","a":"r"},{"f":"=B2*C2","a":"r"}],[{"t":"Remediation, per page"},{"t":"38","a":"r"},{"t":"5","a":"r"},{"f":"=B3*C3","a":"r"}],[{"t":"Alt text, per figure"},{"t":"12","a":"r"},{"t":"8","a":"r"},{"f":"=B4*C4","a":"r"}],[{"t":"**Total**","cs":3,"a":"r"},{"t":"","rs":0,"cs":0},{"t":"","rs":0,"cs":0},{"f":"=SUM(D2:D4)","a":"r","bg":"#ddf4ff"}],[{"t":"Average line","cs":3,"a":"r"},{"t":"","rs":0,"cs":0},{"t":"","rs":0,"cs":0},{"f":"=AVERAGE(D2:D4)","a":"r"}]]}
```

## No borders

A block with Vtable's `noline` style prints without cell borders.

```vtable
{"style":"noline","rows":[[{"t":"Setting"},{"t":"Value"}],[{"t":"Page size"},{"t":"A4"}],[{"t":"Font"},{"t":"Inter, 10 pt"}],[{"t":"Margins"},{"t":"40 pt"}]]}
```

## Cells the PDF cannot draw

A chart cell prints as text, with a note under the table.

```vtable
{"rows":[[{"t":"Quarter"},{"t":"Revenue","a":"r"},{"t":"Trend"}],[{"t":"Q3"},{"t":"$184,700","a":"r"},{"t":"","chart":{"type":"vbarchart"},"rs":2,"va":"m"}],[{"t":"Q4"},{"t":"$197,450","a":"r"},{"t":"","rs":0,"cs":0}]]}
```

## Not a Vtable table

Invalid JSON is left alone and prints as a code block.

```vtable
{"rows": [[{"t": "missing a closing bracket"}]
```
