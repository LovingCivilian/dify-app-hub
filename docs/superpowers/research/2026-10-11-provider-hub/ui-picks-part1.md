# UI picks, part 1: candidate components per UI element (2026-10-11)

**How to read.** Each element (E1–E11) starts with what the code uses today. Then comes one row per candidate component or variant: its visual props with their allowed values, a neutral one-line description of the look, the docs page and the demos that show it. Nothing is ranked. Write your choice on the "Owner's pick:" line at the end of each element.

**Flags.** **Deprecated** means it is still in the code but the 6.6.5 docs say to replace it. **X** means Ant Design X. **6.x+** gives the antd version a prop needs. **icons-6 only** means the icon is missing from the installed `@ant-design/icons` 5.6.1. ProComponents and third-party packages appear only in each element's "Not available" line.

**Checked against:**

- antd 6.6.5, the installed version (ant.design also serves 6.6.5). Sources: `antd info|demo|doc --version 6.6.5`, the live pages crawled on 2026-10-11, and the type definitions in `node_modules/antd/es` where the docs table says nothing.
- Ant Design X 2.9.0 (x.ant.design and `.claude/skills/x-components`).
- `@ant-design/icons` 5.6.1, the project's own dependency, and 6.3.4, which antd 6 depends on and which is also in the tree.

**Notes that apply throughout:**

- **Demo links.** antd demos are at `https://ant.design/components/<page>#<page>-demo-<demo>`, with the anchor in lowercase (`maxCount` becomes `maxcount`). The Drawer and Icon pages are the exceptions: `#components-drawer-demo-<demo>` and `#components-icon-demo-<demo>`. X demos are at `https://x.ant.design/components/<page>#<page>-demo-<demo>`. Every demo link below was matched against the live pages.
- **Sizes.** antd 6.6.5 documents `size` as `small` / `medium` / `large`. The 6.3.2 changelog says "Unify `size` enumeration", and `middle` still type-checks.
- **Deprecated props are not offered as variants.** Among them: Divider `type`, Steps `direction`, `labelPlacement`, `progressDot` and item `description` (use `orientation`, `titlePlacement`, `type="dot"` and `content`), Tabs `tabPosition`, Space `direction`, Drawer `width`/`height` (use `size`), Tag `bordered`, Alert `message` (use `title`), Input `addonBefore`/`addonAfter` (use Space.Compact), Collapse `expandIconPosition` and Button `iconPosition`.

---

## E1. The provider choice at the start of "Add app" (2–5 providers)

**Used today:** none. The "New" button in the page header opens the Dify form directly. In the same form, the access choice uses `Radio.Group optionType="button"`.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Radio.Group, radios | `optionType="default"`; `orientation` horizontal / vertical; option `label` is a ReactNode, so it can hold an icon and text (the docs table says `string`; the types say ReactNode); `disabled` | Round radio dots with labels, in a row or a column | [radio](https://ant.design/components/radio) | [radiogroup-options](https://ant.design/components/radio#radio-demo-radiogroup-options) · [radiogroup-more](https://ant.design/components/radio#radio-demo-radiogroup-more) |
| Radio.Group, buttons, outline | `optionType="button"` `buttonStyle="outline"` (the default); `size` small / medium / large | Joined buttons; the chosen one gets a primary-coloured border and text | [radio](https://ant.design/components/radio) | [radiobutton](https://ant.design/components/radio#radio-demo-radiobutton) · [size](https://ant.design/components/radio#radio-demo-size) |
| Radio.Group, buttons, solid | `buttonStyle="solid"` | Joined buttons; the chosen one is filled with the primary colour | [radio](https://ant.design/components/radio) | [radiobutton-solid](https://ant.design/components/radio#radio-demo-radiobutton-solid) |
| Radio.Group, block | `block` (5.21), with button or radio options | The options stretch to the full width in equal parts | [radio](https://ant.design/components/radio) | [radiogroup-block](https://ant.design/components/radio#radio-demo-radiogroup-block) |
| Segmented | `options` items with `label`, `icon`, `tooltip`, `disabled`; `size` small / medium / large; `shape` default / round (5.24); `block`; `orientation` horizontal / vertical; `disabled` | A grey track with a white "thumb" that slides to the chosen option | [segmented](https://ant.design/components/segmented) | [basic](https://ant.design/components/segmented#segmented-demo-basic) · [with-icon](https://ant.design/components/segmented#segmented-demo-with-icon) · [icon-only](https://ant.design/components/segmented#segmented-demo-icon-only) · [block](https://ant.design/components/segmented#segmented-demo-block) · [vertical](https://ant.design/components/segmented#segmented-demo-vertical) · [shape](https://ant.design/components/segmented#segmented-demo-shape) · [size](https://ant.design/components/segmented#segmented-demo-size) |
| Segmented, custom render | `label` as a ReactNode, e.g. an Avatar above a name and a short line | Taller segments, each holding an icon and text | [segmented](https://ant.design/components/segmented) | [custom](https://ant.design/components/segmented#segmented-demo-custom) |
| Select | `variant` outlined / filled / borderless / underlined; `size`; `prefix` (an icon in the field, 5.22); `optionRender` (icon, name and description in the list, 5.11); `labelRender` (the chosen value with its icon, 5.15); `placement` bottomLeft / bottomRight / topLeft / topRight | A closed field; the options open in a list under it | [select](https://ant.design/components/select) | [variant](https://ant.design/components/select#select-demo-variant) · [option-render](https://ant.design/components/select#select-demo-option-render) · [custom-label-render](https://ant.design/components/select#select-demo-custom-label-render) · [suffix](https://ant.design/components/select#select-demo-suffix) · [size](https://ant.design/components/select#select-demo-size) |
| Tag.CheckableTagGroup, single | `options`; `multiple` left off, so one value is picked; `disabled`; `Tag.CheckableTag` takes an `icon` (5.27) | Small chips in a row; the chosen chip is filled with the primary colour | [tag](https://ant.design/components/tag) | [checkable](https://ant.design/components/tag#tag-demo-checkable) |
| Card as option tiles | `hoverable`; `variant` outlined / borderless; `size` medium / small; `Card.Meta` with `avatar`, `title`, `description`; `cover`; `actions`; laid out with Flex, Row/Col or Masonry | Boxes with an icon, a name and a line of text, which lift on hover. Card has no selected state of its own, so the chosen card looks the same as the others unless it is styled | [card](https://ant.design/components/card) | [meta](https://ant.design/components/card#card-demo-meta) · [simple](https://ant.design/components/card#card-demo-simple) · [border-less](https://ant.design/components/card#card-demo-border-less) · [in-column](https://ant.design/components/card#card-demo-in-column) |
| Card.Grid | `hoverable` (default true) | Equal cells inside one card; a cell lifts on hover; no selected state | [card](https://ant.design/components/card) | [grid-card](https://ant.design/components/card#card-demo-grid-card) |
| BorderBeam, as decoration on a chosen card | `color` (a colour or gradient stops) and `outset` (6.4); `duration`, `lineWidth` and `size` (6.5); `count` (6.6) | A light that runs along a container's border. Decorative only; it picks nothing | [border-beam](https://ant.design/components/border-beam) | [basic](https://ant.design/components/border-beam#border-beam-demo-basic) · [hover](https://ant.design/components/border-beam#border-beam-demo-hover) · [customized-color](https://ant.design/components/border-beam#border-beam-demo-customized-color) |
| Listy (6.6.0+) | `items`, `itemRender`, `group` with `sticky` headers, `height` / `virtual` | A plain list of rows you render; no selected state | [listy](https://ant.design/components/listy) | [basic](https://ant.design/components/listy#listy-demo-basic) · [rich](https://ant.design/components/listy#listy-demo-rich) · [group](https://ant.design/components/listy#listy-demo-group) |
| List (**deprecated** in 6.6.5: "Please use Listy instead") | `itemLayout` horizontal / vertical; `bordered`; `size`; `List.Item.Meta` | Rows with avatar, title and description | [list](https://ant.design/components/list) | [basic](https://ant.design/components/list#list-demo-basic) |
| Menu | `mode` vertical / inline / horizontal; `theme` light / dark; items with `icon`, `label`, `extra` (5.21); `selectedKeys` | A menu column or bar; the chosen item is highlighted | [menu](https://ant.design/components/menu) | [vertical](https://ant.design/components/menu#menu-demo-vertical) · [inline](https://ant.design/components/menu#menu-demo-inline) · [horizontal](https://ant.design/components/menu#menu-demo-horizontal) · [theme](https://ant.design/components/menu#menu-demo-theme) |
| Dropdown on the "Add app" button | `trigger` click / hover / contextMenu; `placement` top / topLeft / topRight / bottom / bottomLeft / bottomRight / left / leftTop / leftBottom / right / rightTop / rightBottom (left and right since 6.5); `arrow`; `menu.items` with `icon` and `extra`; the Button's `icon` and `iconPlacement="end"` | The "Add app" button opens a menu; each item opens the form for that provider | [dropdown](https://ant.design/components/dropdown) | [basic](https://ant.design/components/dropdown#dropdown-demo-basic) · [trigger](https://ant.design/components/dropdown#dropdown-demo-trigger) · [placement](https://ant.design/components/dropdown#dropdown-demo-placement) · [arrow](https://ant.design/components/dropdown#dropdown-demo-arrow) · [extra](https://ant.design/components/dropdown#dropdown-demo-extra) |
| Split button: Space.Compact + Button + Dropdown | A main Button, plus an icon Button that opens the menu; the Button variants as in E7 | A main "Add app" button with a small arrow or ellipsis button joined to its side | [dropdown](https://ant.design/components/dropdown) | [dropdown-button](https://ant.design/components/dropdown#dropdown-demo-dropdown-button) |
| Dropdown.Button | **Deprecated** in 6: no longer in the 6.6.5 docs. `dropdown-button.js` says "Please use Space.Compact + Dropdown + Button instead" (the row above) | — | — | — |
| One Button per provider | Button `type`, or `color` + `variant`, plus `icon`, `size` and `block`; laid out with Flex/Space, or joined with Space.Compact | Several buttons side by side, such as "Add Dify app" and "Add AG-UI agent" | [button](https://ant.design/components/button) | [icon](https://ant.design/components/button#button-demo-icon) · [multiple](https://ant.design/components/button#button-demo-multiple) · [compact-buttons](https://ant.design/components/space#space-demo-compact-buttons) |
| Steps as a wizard bar (the pick itself is step 1, made with another control) | `type` default / dot / inline / navigation / panel; `variant` filled / outlined; `size` medium / small; `orientation` horizontal / vertical; `titlePlacement` horizontal / vertical; items with `icon`, `subTitle`, `content`, `disabled`; clickable through `onChange` | A numbered bar above the form, e.g. "1 Provider → 2 Details → 3 Test" | [steps](https://ant.design/components/steps) | [simple](https://ant.design/components/steps#steps-demo-simple) · [clickable](https://ant.design/components/steps#steps-demo-clickable) · [nav](https://ant.design/components/steps#steps-demo-nav) · [panel](https://ant.design/components/steps#steps-demo-panel) · [inline](https://ant.design/components/steps#steps-demo-inline) · [progress-dot](https://ant.design/components/steps#steps-demo-progress-dot) · [icon](https://ant.design/components/steps#steps-demo-icon) · [vertical](https://ant.design/components/steps#steps-demo-vertical) · [title-placement](https://ant.design/components/steps#steps-demo-title-placement) |
| Tabs | `type` line / card; `tabPlacement` top / bottom / start / end; `centered`; `size`; item `icon`; `indicator` | One tab per provider; the active tab shows that provider's form | [tabs](https://ant.design/components/tabs) | [basic](https://ant.design/components/tabs#tabs-demo-basic) · [card](https://ant.design/components/tabs#tabs-demo-card) · [placement](https://ant.design/components/tabs#tabs-demo-placement) · [centered](https://ant.design/components/tabs#tabs-demo-centered) · [icon](https://ant.design/components/tabs#tabs-demo-icon) · [size](https://ant.design/components/tabs#tabs-demo-size) |
| Collapse, accordion | `accordion`; `ghost`; `bordered`; `size`; `expandIconPlacement` start / end | One panel per provider; opening a panel picks that provider and shows its form | [collapse](https://ant.design/components/collapse) | [accordion](https://ant.design/components/collapse#collapse-demo-accordion) · [ghost](https://ant.design/components/collapse#collapse-demo-ghost) |
| Cascader (fits only if the provider and its app type are picked in one control) | `variant` outlined / filled / borderless / underlined; `size`; `expandTrigger` click / hover; `optionRender`; `displayRender`; `prefix` | A field whose list opens in columns: the provider first, then its type | [cascader](https://ant.design/components/cascader) | [basic](https://ant.design/components/cascader#cascader-demo-basic) · [hover](https://ant.design/components/cascader#cascader-demo-hover) · [custom-render](https://ant.design/components/cascader#cascader-demo-custom-render) · [variant](https://ant.design/components/cascader#cascader-demo-variant) |
| Modal as a separate first step | Any picker above inside it; `width` (a number, a string, or a breakpoint object since 5.23); `centered`; `footer`; `mask` with `blur` / `closable` | A dialog asks for the provider first; the form opens after | [modal](https://ant.design/components/modal) | [basic](https://ant.design/components/modal#modal-demo-basic) · [width](https://ant.design/components/modal#modal-demo-width) · [position](https://ant.design/components/modal#modal-demo-position) · [mask](https://ant.design/components/modal#modal-demo-mask) |
| **X** Prompts | `items` with `icon`, `label`, `description`, `disabled`; `vertical`; `wrap`; `title`; `fadeIn` / `fadeInLeft` | Clickable cards with an icon, a label and a description. Built for chat prompt suggestions; it has no selected state and fires `onItemClick` | [prompts](https://x.ant.design/components/prompts) | [basic](https://x.ant.design/components/prompts#prompts-demo-basic) · [flex-vertical](https://x.ant.design/components/prompts#prompts-demo-flex-vertical) · [flex-wrap](https://x.ant.design/components/prompts#prompts-demo-flex-wrap) · [flex-wrap-fixed](https://x.ant.design/components/prompts#prompts-demo-flex-wrap-fixed) · [disabled](https://x.ant.design/components/prompts#prompts-demo-disabled) |
| **X** Conversations | `items` with `label`, `icon`, `group`, `disabled`; `activeKey`; `groupable` | A sidebar-style list with the active row highlighted. Built for conversation lists | [conversations](https://x.ant.design/components/conversations) | [basic](https://x.ant.design/components/conversations#conversations-demo-basic) · [group](https://x.ant.design/components/conversations#conversations-demo-group) |

**Considered, not a fit:** Checkbox.Group (several picks), TreeSelect (the same as Cascader, but drawn as a tree), FloatButton (floats over a page corner), AutoComplete and Mentions (free text), Switch, Rate, Slider, Transfer, Tree, Timeline, Carousel and Tour.

**Not available:** ProComponents `CheckCard` (a card that works as a single-choice option) and `StepsForm`; ProComponents does not support antd 6.

Owner's pick: **Select**, a plain dropdown (owner, 2026-10-11: "just a normal drop down"). The default `variant="outlined"` and size, with plain text options; no option render, icon or description unless the owner asks.

---

## E2. The container of the app form

**Used today:** a Drawer with the default placement (`right`), `size="large"` (736 px) and `destroyOnHidden`. Cancel and Update/OK sit in `extra` (top-right), and the submit button reaches the form through the HTML `form` attribute.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Drawer | `placement` top / right / bottom / left; `size` default (378 px) / large (736 px) / a number / a string (6.2); `resizable` (6.1) with `maxSize` (6.0); buttons in `extra` (header) or `footer`; `loading` (Skeleton); `mask` true / false / { enabled, blur, closable }; `closable` with `placement` start / end (5.28); `push` for nested drawers | A panel that slides in from an edge over the page | [drawer](https://ant.design/components/drawer) | [basic-right](https://ant.design/components/drawer#components-drawer-demo-basic-right) · [placement](https://ant.design/components/drawer#components-drawer-demo-placement) · [size](https://ant.design/components/drawer#components-drawer-demo-size) · [resizable](https://ant.design/components/drawer#components-drawer-demo-resizable) · [extra](https://ant.design/components/drawer#components-drawer-demo-extra) · [form-in-drawer](https://ant.design/components/drawer#components-drawer-demo-form-in-drawer) · [loading](https://ant.design/components/drawer#components-drawer-demo-loading) · [mask](https://ant.design/components/drawer#components-drawer-demo-mask) · [closable-placement](https://ant.design/components/drawer#components-drawer-demo-closable-placement) · [multi-level-drawer](https://ant.design/components/drawer#components-drawer-demo-multi-level-drawer) |
| Modal | `width` (a number, a string, or a breakpoint object since 5.23); `centered`; `footer` as a ReactNode or a render function with `OkBtn` / `CancelBtn`; `loading`; `mask` { enabled, blur, closable }; `closable` | A dialog over a dimmed page, placed near the top or centred | [modal](https://ant.design/components/modal) | [basic](https://ant.design/components/modal#modal-demo-basic) · [width](https://ant.design/components/modal#modal-demo-width) · [position](https://ant.design/components/modal#modal-demo-position) · [footer](https://ant.design/components/modal#modal-demo-footer) · [footer-render](https://ant.design/components/modal#modal-demo-footer-render) · [loading](https://ant.design/components/modal#modal-demo-loading) · [form-in-modal](https://ant.design/components/form#form-demo-form-in-modal) |
| A page of its own: a route with a Form inside a Card | Card `variant` outlined / borderless, `size`, `title`, `extra`; Breadcrumb for the way back; Affix to keep the action bar in view | A full page, e.g. `/app-management/new`; the browser's back button works | [card](https://ant.design/components/card) · [breadcrumb](https://ant.design/components/breadcrumb) · [affix](https://ant.design/components/affix) | [card basic](https://ant.design/components/card#card-demo-basic) · [breadcrumb basic](https://ant.design/components/breadcrumb#breadcrumb-demo-basic) · [affix basic](https://ant.design/components/affix#affix-demo-basic) |
| An inline Card on the table page | A Card above the table, opened by the "Add app" button (on its own or inside a Collapse) | The form opens in the page itself, above the table | [card](https://ant.design/components/card) | [basic](https://ant.design/components/card#card-demo-basic) |
| Splitter (the table and the form side by side) | `orientation` horizontal / vertical; Panel `defaultSize`, `min`, `max`, `resizable`, `collapsible`; `lazy` | The table on one side and the form on the other, with a draggable bar between them | [splitter](https://ant.design/components/splitter) | [size](https://ant.design/components/splitter#splitter-demo-size) · [collapsible](https://ant.design/components/splitter#splitter-demo-collapsible) · [lazy](https://ant.design/components/splitter#splitter-demo-lazy) · [customize](https://ant.design/components/splitter#splitter-demo-customize) |
| Drawer + Steps, or Modal + Steps (wizard) | The Steps variants from E1, placed in the container's header or body | The container shows a step bar, e.g. "Provider → Details → Test" | [steps](https://ant.design/components/steps) | [clickable](https://ant.design/components/steps#steps-demo-clickable) · [nav](https://ant.design/components/steps#steps-demo-nav) · [panel](https://ant.design/components/steps#steps-demo-panel) |

**Not available:** ProComponents `DrawerForm`, `ModalForm` and `StepsForm` (no antd 6 support).

Owner's pick: **today's Drawer, unchanged** (owner, 2026-10-11: "same as today"): `placement` right, `size="large"` (736 px), not resizable, Cancel and OK in `extra`, the default mask, the default close button.

---

## E3. How the form's sections are separated (shared part, provider part and sub-sections)

**Used today:** `Divider titlePlacement="start"` before each group (Request, Basic, Access, Conversation, More), with Form `layout="vertical"`. When editing, a `Descriptions` block sits on top (`column={1}`, `size="small"`, no border).

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Divider with a title | `titlePlacement` start / center / end; `variant` solid / dashed / dotted (5.20); `plain` (normal-weight title); `size` small / medium / large (the spacing around it, 5.25) | A horizontal line with the section name inside it | [divider](https://ant.design/components/divider) | [with-text](https://ant.design/components/divider#divider-demo-with-text) · [variant](https://ant.design/components/divider#divider-demo-variant) · [plain](https://ant.design/components/divider#divider-demo-plain) · [size](https://ant.design/components/divider#divider-demo-size) |
| Divider without a title | `variant`, `size` (as above) | A plain line between groups | [divider](https://ant.design/components/divider) | [horizontal](https://ant.design/components/divider#divider-demo-horizontal) |
| Typography.Title | `level` 1 / 2 / 3 / 4 / 5; `type` secondary / success / warning / danger | A heading above each section, with no line | [typography](https://ant.design/components/typography) | [title](https://ant.design/components/typography#typography-demo-title) |
| Typography.Text as a sub-heading | `strong`; `type` secondary | A bold or grey line naming a sub-section | [typography](https://ant.design/components/typography) | [text](https://ant.design/components/typography#typography-demo-text) |
| Card per section | `title`, `extra`; `variant` outlined / borderless; `size` medium / small; `type="inner"` (a nested card with a lighter header) | Each section in its own box with a header bar | [card](https://ant.design/components/card) | [basic](https://ant.design/components/card#card-demo-basic) · [simple](https://ant.design/components/card#card-demo-simple) · [border-less](https://ant.design/components/card#card-demo-border-less) · [inner](https://ant.design/components/card#card-demo-inner) |
| Collapse per section | `items` with `label` and `extra`; `bordered`; `ghost`; `size`; `expandIconPlacement` start / end; `collapsible` header / icon / disabled; `accordion`; item `showArrow` | Sections fold open and shut; a closed section shows only its title | [collapse](https://ant.design/components/collapse) | [basic](https://ant.design/components/collapse#collapse-demo-basic) · [borderless](https://ant.design/components/collapse#collapse-demo-borderless) · [ghost](https://ant.design/components/collapse#collapse-demo-ghost) · [size](https://ant.design/components/collapse#collapse-demo-size) · [collapsible](https://ant.design/components/collapse#collapse-demo-collapsible) · [extra](https://ant.design/components/collapse#collapse-demo-extra) · [noarrow](https://ant.design/components/collapse#collapse-demo-noarrow) |
| Tabs per section | `type` line / card; `tabPlacement` top / bottom / start / end; `size`; `centered` | One section visible at a time, behind tabs | [tabs](https://ant.design/components/tabs) | [basic](https://ant.design/components/tabs#tabs-demo-basic) · [card](https://ant.design/components/tabs#tabs-demo-card) · [placement](https://ant.design/components/tabs#tabs-demo-placement) |
| Steps (wizard) | The E1 Steps variants | One section per step, with Next and Back | [steps](https://ant.design/components/steps) | [clickable](https://ant.design/components/steps#steps-demo-clickable) · [panel](https://ant.design/components/steps#steps-demo-panel) |
| Anchor (for a long form) | `direction` vertical / horizontal; `affix`; nested `items`; `targetOffset` | A side or top list of section links that highlights the section in view | [anchor](https://ant.design/components/anchor) | [basic](https://ant.design/components/anchor#anchor-demo-basic) · [horizontal](https://ant.design/components/anchor#anchor-demo-horizontal) · [static](https://ant.design/components/anchor#anchor-demo-static) |
| Space or Flex (white space only) | `gap` small / medium / large / a number | Groups separated only by space | [flex](https://ant.design/components/flex) | [gap](https://ant.design/components/flex#flex-demo-gap) |
| _Related choice:_ Form `layout` | horizontal / vertical / inline; Form.Item `layout` per item (5.18, mixed layouts) | Labels above the fields (vertical) or beside them (horizontal) | [form](https://ant.design/components/form) | [layout](https://ant.design/components/form#form-demo-layout) · [layout-multiple](https://ant.design/components/form#form-demo-layout-multiple) |
| _Related:_ labels | `labelAlign` left / right; `labelWrap`; `labelCol` / `wrapperCol` (grid spans); `colon` | Where labels sit and how wide they are in horizontal layout | [form](https://ant.design/components/form) | [layout-can-wrap](https://ant.design/components/form#form-demo-layout-can-wrap) |
| _Related:_ `requiredMark` | true / false / `optional` / a render function | A red asterisk, nothing, or "(optional)" after the label | [form](https://ant.design/components/form) | [required-mark](https://ant.design/components/form#form-demo-required-mark) |
| _Related:_ Form `variant` and `size` | `variant` outlined / filled / borderless / underlined; `size` small / medium / large | The field style and height for the whole form | [form](https://ant.design/components/form) | [variant](https://ant.design/components/form#form-demo-variant) · [size](https://ant.design/components/form#form-demo-size) |

**Not available:** ProComponents `ProForm.Group`, `ProCard` (collapsible and split cards) and ProForm's `grid` layout (no antd 6 support).

Owner's pick (owner, 2026-10-11: "bordered collapse per section. layout beside. require Astrix and optional"):

- **Sections:** today's plain `Divider` with its title at the start (`titlePlacement="start"`), no Collapse (owner, 2026-10-11: "its plain dividers with no collapse"). An earlier pick of a bordered Collapse was withdrawn.
- **Form `layout="horizontal"`:** labels beside the fields.
- **`requiredMark`:** an asterisk on required fields **and** "(optional)" on optional ones. antd's built-in values are either-or: `true` gives the asterisk, `'optional'` gives the text. With a render function, antd hides its own asterisk (`FormItemLabel.js` sets `required-mark-optional` for a function, and the style hides `::before`). So the documented customize form, `(label, { required }) => ReactNode` (since 5.9.0, demo `form#form-demo-required-mark`), draws both: the asterisk before the label in the error colour token, as antd's own does, and "(optional)" through i18n after it.

---

## E4. The icon upload field (PNG/JPEG/WebP, one image)

**Used today:** the app form has no icon field; the icon comes from Dify, and `AppIcon` shows it as a square Avatar (emoji, image, or the mode icon). The nearest existing pattern is the branding page's image field:

- an Upload with `showUploadList={false}`, `accept`, and a `beforeUpload` that returns `false` or `Upload.LIST_IGNORE`;
- a child `Button` with `UploadOutlined`;
- an `Image` preview with `preview={false}`;
- a separate Remove `Button` with `DeleteOutlined`.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Upload + Button, no list | `showUploadList={false}`; Button `type`, or `color` + `variant`, plus `icon` and `size` | A "Choose image" button; the preview is drawn beside it by the page | [upload](https://ant.design/components/upload) | [basic](https://ant.design/components/upload#upload-demo-basic) · [upload-manually](https://ant.design/components/upload#upload-demo-upload-manually) · [upload-png-only](https://ant.design/components/upload#upload-demo-upload-png-only) |
| Upload, `listType="text"` (the default) | `maxCount={1}` (a new pick replaces the old) | A button with a file-name row under it, which has a remove icon | [upload](https://ant.design/components/upload) | [defaultfilelist](https://ant.design/components/upload#upload-demo-defaultfilelist) · [max-count](https://ant.design/components/upload#upload-demo-max-count) |
| Upload, `listType="picture"` | `maxCount={1}` | A button with a row under it: thumbnail, name and remove icon | [upload](https://ant.design/components/upload) | [picture-style](https://ant.design/components/upload#upload-demo-picture-style) |
| Upload, `listType="picture-card"` | `maxCount={1}`; `showUploadList` { showPreviewIcon, showRemoveIcon, removeIcon, extra (5.20) }, or `false` with the image as the child | A square dashed tile with "+ Upload"; after a pick it shows the image, with preview and remove icons on hover | [upload](https://ant.design/components/upload) | [picture-card](https://ant.design/components/upload#upload-demo-picture-card) · [avatar](https://ant.design/components/upload#upload-demo-avatar) |
| Upload, `listType="picture-circle"` (5.2) | as picture-card | The same as picture-card, but round | [upload](https://ant.design/components/upload) | [picture-circle](https://ant.design/components/upload#upload-demo-picture-circle) · [avatar](https://ant.design/components/upload#upload-demo-avatar) |
| Upload.Dragger (shown as `Upload.Dragger` in the "Drag and Drop" demo; the API table has no row for it) | The Upload props, with an icon, a title and a hint as children | A large dashed drop zone, clickable as well | [upload](https://ant.design/components/upload) | [drag](https://ant.design/components/upload#upload-demo-drag) |
| Upload `pastable` (5.25) | `pastable` | Accepts an image pasted from the clipboard | [upload](https://ant.design/components/upload) | [paste](https://ant.design/components/upload#upload-demo-paste) |
| Upload `accept` | A string, or `{ format, filter }` (AcceptObject) | Limits the file dialog to the listed types | [upload](https://ant.design/components/upload) | [upload-png-only](https://ant.design/components/upload#upload-demo-upload-png-only) |
| Preview with Avatar | `shape` circle / square; `size` small / medium / large / a number / a responsive object | The chosen image in the same shape and size it will have in the gallery and the table | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) · [type](https://ant.design/components/avatar#avatar-demo-type) |
| Preview with Image | `width` / `height`; `preview` true / false / { mask, cover, … }; `alt` | The image itself; with `preview`, a click opens a zoom viewer | [image](https://ant.design/components/image) | [basic](https://ant.design/components/image#image-demo-basic) · [mask](https://ant.design/components/image#image-demo-mask) |
| Remove, with the list's own icon | `showUploadList.showRemoveIcon`, `removeIcon` | A bin icon on the file row or tile | [upload](https://ant.design/components/upload) | [upload-custom-action-icon](https://ant.design/components/upload#upload-demo-upload-custom-action-icon) |
| Remove, with a separate Button | `danger` or `color="danger"` with a `variant`; `icon` `DeleteOutlined` | A "Remove" button beside the preview, as on the branding page | [button](https://ant.design/components/button) | [danger](https://ant.design/components/button#button-demo-danger) · [color-variant](https://ant.design/components/button#button-demo-color-variant) |
| Remove, confirmed first with Popconfirm | `placement`, `icon`, `okButtonProps` | A small "Remove the icon?" bubble on click | [popconfirm](https://ant.design/components/popconfirm) | [basic](https://ant.design/components/popconfirm#popconfirm-demo-basic) |
| **X** Attachments | Inherits the Upload props; `placeholder` { icon, title, description }; `maxCount`; `overflow` | An attachment area with a drop placeholder. Built for the chat input | [attachments](https://x.ant.design/components/attachments) | [basic](https://x.ant.design/components/attachments#attachments-demo-basic) · [placeholder](https://x.ant.design/components/attachments#attachments-demo-placeholder) |
| **X** FileCard (to show the chosen file) | `type="image"`, `src`, `size` small / default, `imageProps` | A file card with the image thumbnail and the file name | [file-card](https://x.ant.design/components/file-card) | [image](https://x.ant.design/components/file-card#file-card-demo-image) · [size](https://x.ant.design/components/file-card#file-card-demo-size) |

**Not available:** `antd-img-crop` (crop before upload) is third-party, although antd's own "Crop image before uploading" demo imports it. Also ProComponents `ProFormUploadButton` and `ProFormUploadDragger` (no antd 6 support).

Owner's pick: **1, Upload + Button with no list**, the branding page's pattern (owner, 2026-10-11).

- The preview is an **Avatar with `shape="square"`**. antd's square Avatar has rounded corners through the border-radius token, which is the "square with rounded corners" asked for. It is drawn at the size the gallery card uses.
- Remove works as on the branding page: a separate default Button with `DeleteOutlined`, not a danger one (owner, 2026-10-12: "Default, like branding"; this line first said "danger", which the branding page's button is not).

---

## E5. Tags input

**Used today:** no tags input, because the tags come from Dify. Tags are shown as default `<Tag>`s (variant `filled`) in the edit drawer's Descriptions, the table and the gallery card.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Select `mode="tags"` | `variant` outlined / filled / borderless / underlined; `size`; `tokenSeparators` (a string array, or a function since 6.5.0); `maxTagCount` (a number or `responsive`); `maxTagTextLength`; `maxCount` (5.13); `tagRender` (your own Tag look); `options` (existing tags offered as suggestions); `allowClear` | A field holding chips. Typing then Enter, or a separator, adds a chip; × removes one | [select](https://ant.design/components/select) | [tags](https://ant.design/components/select#select-demo-tags) · [automatic-tokenization](https://ant.design/components/select#select-demo-automatic-tokenization) · [custom-tokenization](https://ant.design/components/select#select-demo-custom-tokenization) · [custom-tag-render](https://ant.design/components/select#select-demo-custom-tag-render) · [responsive](https://ant.design/components/select#select-demo-responsive) · [maxcount](https://ant.design/components/select#select-demo-maxcount) |
| Select `mode="multiple"` | As above, without free text | Chips picked from a fixed list only | [select](https://ant.design/components/select) | [multiple](https://ant.design/components/select#select-demo-multiple) |
| Tag, the "Add & Remove Dynamically" pattern | `closeIcon` (documented); `closable` (in the types as "Advised to use closeIcon instead", with no docs row; the demo uses it); `onClose`; a dashed "+ New tag" Tag that turns into a small Input; double-click to edit | Loose chips with ×, followed by a dashed "+ New tag" chip | [tag](https://ant.design/components/tag) | [control](https://ant.design/components/tag#tag-demo-control) · [animation](https://ant.design/components/tag#tag-demo-animation) |
| Tag look (for any of these) | `variant` filled (the default) / solid / outlined (6.0); `color` takes 11 presets (magenta, red, volcano, orange, gold, lime, green, cyan, blue, geekblue, purple), 5 status colours (success, processing, warning, error, default) or any CSS colour; `icon` | Filled: a tinted background. Solid: a strong background with white text. Outlined: a border only | [tag](https://ant.design/components/tag) | [basic](https://ant.design/components/tag#tag-demo-basic) · [colorful](https://ant.design/components/tag#tag-demo-colorful) · [status](https://ant.design/components/tag#tag-demo-status) · [icon](https://ant.design/components/tag#tag-demo-icon) |
| Tag.CheckableTagGroup `multiple` | `options` set to the existing tags; `disabled` | Chips that toggle on and off; no free text | [tag](https://ant.design/components/tag) | [checkable](https://ant.design/components/tag#tag-demo-checkable) |
| Input + Button + a Tag list | Space.Compact (Input and an "Add" Button), then closable Tags in a wrapping Flex | A text box with "Add"; the chips are listed below it | [input](https://ant.design/components/input) · [space](https://ant.design/components/space) | [compact-style](https://ant.design/components/input#input-demo-compact-style) · [compact](https://ant.design/components/space#space-demo-compact) |
| AutoComplete + a Tag list | `options` as suggestions; `variant` | Typing suggests existing tags; picking one adds a chip below | [auto-complete](https://ant.design/components/auto-complete) | [basic](https://ant.design/components/auto-complete#auto-complete-demo-basic) |
| Form.List | Dynamic fields with add and remove buttons | One input row per tag, each with a remove icon | [form](https://ant.design/components/form) | [dynamic-form-item](https://ant.design/components/form#form-demo-dynamic-form-item) |

**Not available:** draggable tags need `@dnd-kit` (third-party; antd's own "Draggable Tag" demo imports it). Also ProComponents `ProFormSelect` (no antd 6 support).

Owner's pick: delegated (owner, 2026-10-11: "for the rest do as you see fit. vanilla showcase style"). Claude chose antd's showcase defaults: **`Select mode="tags"`** (demo `tags`), default outlined variant, `tokenSeparators={[',']}` (demo `automatic-tokenization`), the tags already used by other apps offered as `options`. Chips stay the default `Tag` (filled) here, in the table and on the card.

---

## E6. Description field

**Used today:** no input, because the description comes from Dify. It is shown read-only in the edit drawer's Descriptions, and as `Typography.Paragraph` with a two-row ellipsis in the table and on the card.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Input.TextArea | `autoSize` true / { minRows, maxRows }; native `rows`; `showCount` true / { formatter }; `maxLength` (native, cuts the text off); `count` { max, strategy, show, exceedFormatter } (5.10: marks text over the limit without cutting it); `variant` outlined / filled / borderless / underlined; `size`; `allowClear`; `status` error / warning | A multi-line box; with a count, a "12 / 200" counter at the bottom right | [input](https://ant.design/components/input) | [textarea](https://ant.design/components/input#input-demo-textarea) · [autosize-textarea](https://ant.design/components/input#input-demo-autosize-textarea) · [show-count](https://ant.design/components/input#input-demo-show-count) · [advance-count](https://ant.design/components/input#input-demo-advance-count) · [variant](https://ant.design/components/input#input-demo-variant) · [allowclear](https://ant.design/components/input#input-demo-allowclear) |
| Input, one line | The same `count`, `showCount`, `variant` and `size` | A single-line field | [input](https://ant.design/components/input) | [show-count](https://ant.design/components/input#input-demo-show-count) |
| Typography.Paragraph `editable` | `editable` { autoSize, maxLength, triggerType icon / text, enterIcon, tooltip } | Plain text that turns into a text area when its pencil is clicked | [typography](https://ant.design/components/typography) | [editable](https://ant.design/components/typography#typography-demo-editable) |

**Considered, not a fit:** Mentions (a text area for @-mentions). X Sender is a chat input, not a form field.

**Not available:** rich-text and Markdown editors (third-party).

Owner's pick: delegated ("vanilla showcase style"). **`Input.TextArea`** with `autoSize={{ minRows: 2, maxRows: 6 }}` (demo `autosize-textarea`), default outlined variant. The length limit sits in the zod schema.

---

## E7. The "Test connection" button and how its result is shown

**Used today:** no test button. A refused key or an unreachable base is reported on save through `App.useApp().message.error`.

**The button**

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Button `type` (shorthand) | primary / default / dashed / text / link | The five classic looks | [button](https://ant.design/components/button) | [basic](https://ant.design/components/button#button-demo-basic) |
| Button `color` × `variant` | `color` default / primary / danger, or one of 13 presets (blue, purple, cyan, green, magenta, pink, red, orange, yellow, volcano, geekblue, lime, gold); `variant` outlined / dashed / solid / filled / text / link | Six looks per colour: solid fill, outline, dashed outline, tinted fill, text only, link | [button](https://ant.design/components/button) | [color-variant](https://ant.design/components/button#button-demo-color-variant) |
| Button `size`, `shape` | `size` small / medium / large; `shape` default / circle / round | Height, and corners: rounded rectangle, circle or pill | [button](https://ant.design/components/button) | [size](https://ant.design/components/button#button-demo-size) · [icon](https://ant.design/components/button#button-demo-icon) |
| Button `icon` and `iconPlacement` | Any icon (e.g. `ApiOutlined`, `LinkOutlined`, `ThunderboltOutlined`); `iconPlacement` start / end | An icon before or after the label, or an icon-only button | [button](https://ant.design/components/button) | [icon](https://ant.design/components/button#button-demo-icon) · [icon-placement](https://ant.design/components/button#button-demo-icon-placement) |
| Button `loading` | true / { delay, icon } | A spinner inside the button while the test runs | [button](https://ant.design/components/button) | [loading](https://ant.design/components/button#button-demo-loading) |
| Button `block`, `ghost`, `danger` | booleans | Full width; transparent on a coloured background; red | [button](https://ant.design/components/button) | [block](https://ant.design/components/button#button-demo-block) · [ghost](https://ant.design/components/button#button-demo-ghost) · [danger](https://ant.design/components/button#button-demo-danger) |
| Where the button sits | In the container's `extra` or `footer`; after the provider fields; or joined to the API key field through Space.Compact (Input + Button) | — | [space](https://ant.design/components/space) | [compact](https://ant.design/components/space#space-demo-compact) · [input compact-style](https://ant.design/components/input#input-demo-compact-style) |

**How the result is shown**

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Alert | `type` success / info / warning / error; `variant` outlined / filled (6.4); `showIcon`; `banner`; `title` + `description`; `action`; `closable` | A coloured box with an icon, a title and details, e.g. under the button | [alert](https://ant.design/components/alert) | [basic](https://ant.design/components/alert#alert-demo-basic) · [style](https://ant.design/components/alert#alert-demo-style) · [filled](https://ant.design/components/alert#alert-demo-filled) · [icon](https://ant.design/components/alert#alert-demo-icon) · [description](https://ant.design/components/alert#alert-demo-description) · [banner](https://ant.design/components/alert#alert-demo-banner) · [action](https://ant.design/components/alert#alert-demo-action) · [closable](https://ant.design/components/alert#alert-demo-closable) |
| message (through `App.useApp()`) | success / error / info / warning / loading / open; `duration`; `icon`; `stack` (6.4); a message updated in place by `key` | A small toast at the top centre that fades away | [message](https://ant.design/components/message) | [hooks](https://ant.design/components/message#message-demo-hooks) · [other](https://ant.design/components/message#message-demo-other) · [loading](https://ant.design/components/message#message-demo-loading) · [update](https://ant.design/components/message#message-demo-update) |
| notification (through `App.useApp()`) | success / error / info / warning / open; `placement` top / topLeft / topRight / bottom / bottomLeft / bottomRight; `duration`; `showProgress` (5.18); `actions` (5.24); `role` alert / status | A card in a screen corner with a title and a description | [notification](https://ant.design/components/notification) | [hooks](https://ant.design/components/notification#notification-demo-hooks) · [placement](https://ant.design/components/notification#notification-demo-placement) · [with-icon](https://ant.design/components/notification#notification-demo-with-icon) · [show-with-progress](https://ant.design/components/notification#notification-demo-show-with-progress) |
| Form.Item status on the API base or key field | `validateStatus` success / warning / error / validating; `help`; `hasFeedback` (an icon inside the field); `extra` | The field turns green or red, with a message under it and an icon inside | [form](https://ant.design/components/form) | [validate-static](https://ant.design/components/form#form-demo-validate-static) |
| Input `status` | error / warning | A red or yellow border on the field | [input](https://ant.design/components/input) | [status](https://ant.design/components/input#input-demo-status) |
| Tag as a status chip | `color` success / processing / warning / error / default; `variant` filled / solid / outlined; `icon` (e.g. `CheckCircleOutlined`, `SyncOutlined spin`) | A small coloured chip such as "Connected" or "Failed" next to the button | [tag](https://ant.design/components/tag) | [status](https://ant.design/components/tag#tag-demo-status) |
| Badge status | `status` success / processing / default / error / warning; `text`; `color` | A coloured dot with text; `processing` pulses | [badge](https://ant.design/components/badge) | [status](https://ant.design/components/badge#badge-demo-status) |
| Typography.Text | `type` success / warning / danger / secondary; can carry an icon | A coloured line of text | [typography](https://ant.design/components/typography) | [text](https://ant.design/components/typography#typography-demo-text) |
| Result | `status` success / error / info / warning (also 403 / 404 / 500); `title`, `subTitle`, `extra`, `icon` | A large centred icon with a title; sized for a page or a big area | [result](https://ant.design/components/result) | [success](https://ant.design/components/result#result-demo-success) · [error](https://ant.design/components/result#result-demo-error) · [warning](https://ant.design/components/result#result-demo-warning) · [info](https://ant.design/components/result#result-demo-info) |
| Popover or Tooltip on the button | `placement` top / left / right / bottom / topLeft / topRight / bottomLeft / bottomRight / leftTop / leftBottom / rightTop / rightBottom; `trigger` hover / focus / click / contextMenu; `title` / `content`; `color`; `open` (controlled) | A bubble attached to the button that holds the result | [popover](https://ant.design/components/popover) · [tooltip](https://ant.design/components/tooltip) | [popover placement](https://ant.design/components/popover#popover-demo-placement) · [popover control](https://ant.design/components/popover#popover-demo-control) · [tooltip colorful](https://ant.design/components/tooltip#tooltip-demo-colorful) |
| Spin (while testing) | `size` small / medium / large; `description` (6.3); `percent`; `spinning` around a block | A spinner over the provider part while the test runs | [spin](https://ant.design/components/spin) | [nested](https://ant.design/components/spin#spin-demo-nested) · [tip](https://ant.design/components/spin#spin-demo-tip) · [size](https://ant.design/components/spin#spin-demo-size) |
| Descriptions (what the test read back) | `bordered`; `size`; `column` | Label and value rows, e.g. the app's name and type as the provider reports them | [descriptions](https://ant.design/components/descriptions) | [basic](https://ant.design/components/descriptions#descriptions-demo-basic) · [border](https://ant.design/components/descriptions#descriptions-demo-border) |
| Steps as a checklist | item `status` wait / process / finish / error; `size` small; `orientation` vertical | A short list of checks, e.g. base reached → key accepted → app read, each with its state | [steps](https://ant.design/components/steps) | [error](https://ant.design/components/steps#steps-demo-error) · [vertical](https://ant.design/components/steps#steps-demo-vertical) |
| Timeline as a checklist | items with `color`, `icon`, `loading` | A vertical list of check results with coloured dots | [timeline](https://ant.design/components/timeline) | [basic](https://ant.design/components/timeline#timeline-demo-basic) · [pending](https://ant.design/components/timeline#timeline-demo-pending) |
| **X** ThoughtChain | items with `status` loading / success / error / abort, `title`, `description`, `collapsible`; `line` solid / dashed / dotted / false | A vertical chain of check steps, each with a status icon. Built for agent call chains | [thought-chain](https://x.ant.design/components/thought-chain) | [status](https://x.ant.design/components/thought-chain#thought-chain-demo-status) · [simple](https://x.ant.design/components/thought-chain#thought-chain-demo-simple) |
| **X** ThoughtChain.Item | `status` loading / success / error / abort; `variant` solid / outlined / text; `blink` | A single status row with an icon, a title and a description | [thought-chain](https://x.ant.design/components/thought-chain) | [single-row](https://x.ant.design/components/thought-chain#thought-chain-demo-single-row) |

**Not available:** nothing notable.

Owner's pick: delegated ("vanilla showcase style").

- **The button:** a default `Button` (`type` default) labelled "Test connection", with `loading` while the test runs (demo `loading`). It is the last row of the provider's connection section, aligned with the fields.
- **The result:** an `Alert` under the button (demo `basic`) with `showIcon`, a `title` and a `description`, default variant. It uses `type` success (reachable), warning (type mismatch) or error (unreachable or key refused), and it clears when a connection field changes.

---

## E8. The provider shown read-only when editing

**Used today:** there is no provider yet. In edit mode, a `Descriptions` block (`column={1}`, `size="small"`, no border) shows the name, the description and the tags above the form.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Tag | `variant` filled / solid / outlined; `color`; `icon` | A chip such as "Dify", with its icon | [tag](https://ant.design/components/tag) | [icon](https://ant.design/components/tag#tag-demo-icon) · [colorful](https://ant.design/components/tag#tag-demo-colorful) |
| A Descriptions item (in the existing block) | `bordered`; `size` large / medium / small; `layout` horizontal / vertical; `column`; `title` / `extra` | A labelled row, "Provider: Dify", inside the block that is already there | [descriptions](https://ant.design/components/descriptions) | [basic](https://ant.design/components/descriptions#descriptions-demo-basic) · [border](https://ant.design/components/descriptions#descriptions-demo-border) · [size](https://ant.design/components/descriptions#descriptions-demo-size) · [vertical](https://ant.design/components/descriptions#descriptions-demo-vertical) · [vertical-border](https://ant.design/components/descriptions#descriptions-demo-vertical-border) |
| The E1 picker, disabled | `disabled` on Radio.Group, Segmented, Select or Tag.CheckableTagGroup | The same control as in "Add app", greyed out, with the choice visible | [radio](https://ant.design/components/radio) · [segmented](https://ant.design/components/segmented) · [select](https://ant.design/components/select) | [radio disabled](https://ant.design/components/radio#radio-demo-disabled) · [segmented disabled](https://ant.design/components/segmented#segmented-demo-disabled) |
| Typography.Text | `strong` / `type="secondary"` / `code` | Plain text, "Dify" | [typography](https://ant.design/components/typography) | [text](https://ant.design/components/typography#typography-demo-text) |
| Avatar + text | Avatar `shape` / `size` / `icon` in a Flex with the name | The provider icon and its name side by side | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) |
| Card.Meta | `avatar`, `title`, `description` | A small header block such as "Dify · Chatflow" with the icon | [card](https://ant.design/components/card) | [meta](https://ant.design/components/card#card-demo-meta) |
| Form.Item with plain text | A Form.Item with a `label` and a text child (the antd demo puts antd's own `ant-form-text` class on a `span`) | The label "Provider" with plain text where a field would be | [form](https://ant.design/components/form) | [validate-other](https://ant.design/components/form#form-demo-validate-other) ("Plain Text" row) |
| Input, disabled or read-only | `disabled`, or the native `readOnly` attribute (passed through; antd has no read-only demo); `variant` | A field-shaped box holding "Dify" | [input](https://ant.design/components/input) | [variant](https://ant.design/components/input#input-demo-variant) |
| Alert | `type="info"`, `showIcon`, `banner` | A strip at the top, e.g. "This app uses Dify; the provider cannot be changed" | [alert](https://ant.design/components/alert) | [basic](https://ant.design/components/alert#alert-demo-basic) · [banner](https://ant.design/components/alert#alert-demo-banner) |

**Not available:** ProComponents `ProDescriptions` and ProForm's `readonly` mode (no antd 6 support).

Owner's pick: delegated ("vanilla showcase style"). **The E1 `Select`, `disabled`**, in the same place, so editing looks like adding with the choice greyed out.

---

## E9. The admin table's provider column (with the Dify type) and its filter

**Used today:**

- A "Type" column (`key: 'mode'`) shows the Dify mode as plain text. Its `filters` list the Dify modes, with the defaults `filterMultiple` true and `filterMode` menu.
- The Name column shows `AppIcon` (a small square Avatar) and the name.
- The status and access columns use Tag colours: success, green, warning and blue.

**The cell**

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Tag (one, or two: provider + type) | `variant` filled / solid / outlined; `color`; `icon` | One or two chips, e.g. "Dify" and "Chatflow" | [tag](https://ant.design/components/tag) | [basic](https://ant.design/components/tag#tag-demo-basic) · [colorful](https://ant.design/components/tag#tag-demo-colorful) · [icon](https://ant.design/components/tag#tag-demo-icon) |
| Avatar or icon + text | Avatar `size` small / a number, `shape`, `icon`; or the bare icon | A small provider icon, then "Dify" | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) |
| Icon only + Tooltip | Tooltip `title`, `placement` | An icon; hovering shows the provider's name | [tooltip](https://ant.design/components/tooltip) | [basic](https://ant.design/components/tooltip#tooltip-demo-basic) |
| Badge with text | `status` or `color`, with `text` | A coloured dot, then "Dify" | [badge](https://ant.design/components/badge) | [status](https://ant.design/components/badge#badge-demo-status) · [colorful](https://ant.design/components/badge#badge-demo-colorful) |
| Two lines of Typography.Text | A vertical Flex: the provider, then the type with `type="secondary"` | "Dify", with "Chatflow" in grey under it | [typography](https://ant.design/components/typography) | [text](https://ant.design/components/typography#typography-demo-text) |
| Space with a separator | `separator` (e.g. `·`, or a vertical Divider) | "Dify · Chatflow" on one line | [space](https://ant.design/components/space) | [separator](https://ant.design/components/space#space-demo-separator) |
| Merged into the Name column | The name cell already has the icon; add a secondary line under the name | No separate column; "Dify · Chatflow" sits under the app's name | [table](https://ant.design/components/table) | — |

**The filter**

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Column `filters` | `filters` [{ text (a ReactNode, so it can hold an icon), value, children }]; `filterMultiple` true (checkboxes) / false (radios); `filterSearch` boolean / function; `filterMode` menu / tree (tree allows provider → type); `filterOnClose` (5.15); `filteredValue` / `defaultFilteredValue`; `filterIcon`; `filterDropdownProps` (5.22) | A funnel icon in the column header that opens a checklist, or a tree | [table](https://ant.design/components/table) | [head](https://ant.design/components/table#table-demo-head) · [filter-search](https://ant.design/components/table#table-demo-filter-search) · [filter-in-tree](https://ant.design/components/table#table-demo-filter-in-tree) · [reset-filter](https://ant.design/components/table#table-demo-reset-filter) |
| Column `filterDropdown` (your own panel) | Any content, e.g. a Segmented or a Select | A panel of your own under the funnel | [table](https://ant.design/components/table) | [custom-filter-panel](https://ant.design/components/table#table-demo-custom-filter-panel) |
| Segmented above the table | As in E1 | An "All / Dify / AG-UI" bar beside the search field | [segmented](https://ant.design/components/segmented) | [basic](https://ant.design/components/segmented#segmented-demo-basic) · [with-icon](https://ant.design/components/segmented#segmented-demo-with-icon) |
| Radio.Group buttons above the table | As in E1 | Joined buttons | [radio](https://ant.design/components/radio) | [radiobutton](https://ant.design/components/radio#radio-demo-radiobutton) |
| Select above the table | `variant`, `allowClear`, `mode="multiple"`, `prefix` | A "Provider: All" dropdown beside the search field | [select](https://ant.design/components/select) | [basic](https://ant.design/components/select#select-demo-basic) · [multiple](https://ant.design/components/select#select-demo-multiple) · [variant](https://ant.design/components/select#select-demo-variant) |
| Tabs above the table | `type` line / card; `size` | One tab per provider, plus "All", over the table | [tabs](https://ant.design/components/tabs) | [basic](https://ant.design/components/tabs#tabs-demo-basic) · [card](https://ant.design/components/tabs#tabs-demo-card) |
| Tag.CheckableTagGroup above the table | `multiple`, or one value | Filter chips that toggle on and off | [tag](https://ant.design/components/tag) | [checkable](https://ant.design/components/tag#tag-demo-checkable) |
| Cascader above the table | `multiple`; `showCheckedStrategy`; `variant` | One field that picks a provider and its types | [cascader](https://ant.design/components/cascader) | [multiple](https://ant.design/components/cascader#cascader-demo-multiple) |
| Dropdown with a selectable menu | `menu.selectable`, `selectedKeys`, `multiple` | A "Filter" button that opens a menu with ticks | [dropdown](https://ant.design/components/dropdown) | [selectable](https://ant.design/components/dropdown#dropdown-demo-selectable) |

**Not available:** ProComponents `ProTable` (toolbar filters, `valueEnum` columns; no antd 6 support).

Owner's pick: delegated ("vanilla showcase style").

- **The cell:** today's "Type" column becomes a **"Provider" column of plain text**, as the Type column is today, for example "Dify · Chatflow" or "AG-UI agent".
- **The filter:** the column's built-in `filters` (the funnel; default `filterMode` menu, `filterMultiple` true), listing the providers. The Dify types are nested as `children` under "Dify", so today's filter by type stays.

---

## E10. The gallery card line that replaces the Dify mode

**Used today:**

- `Card hoverable` inside a Next `Link`.
- `Card.Meta`: `avatar` is `AppIcon` (a large square Avatar), `title` is the name, and `description` is the Dify mode's name (e.g. "Chatflow").
- Then the description as a secondary `Typography.Paragraph` (two rows), and the tags as default Tags.

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Card.Meta `description` (text, as today) | Text such as "Dify · Chatflow" or "AG-UI agent" | A grey line under the name | [card](https://ant.design/components/card) | [meta](https://ant.design/components/card#card-demo-meta) |
| Typography.Text | `type="secondary"`; `ellipsis`; an icon before the text | A grey text line, optionally with the provider icon | [typography](https://ant.design/components/typography) | [text](https://ant.design/components/typography#typography-demo-text) |
| Tag | `variant` filled / solid / outlined; `color`; `icon`; in the title row or the tags row | A chip with the provider's name and/or icon | [tag](https://ant.design/components/tag) | [basic](https://ant.design/components/tag#tag-demo-basic) · [colorful](https://ant.design/components/tag#tag-demo-colorful) · [icon](https://ant.design/components/tag#tag-demo-icon) |
| Badge.Ribbon | `text`; `color` (a preset or any colour); `placement` start / end | A coloured ribbon folded over the card's top corner | [badge](https://ant.design/components/badge) | [ribbon](https://ant.design/components/badge#badge-demo-ribbon) |
| Badge on the app icon | `count` as a ReactNode (e.g. the provider's icon), `dot`, `offset`, `size` medium / small | A small provider icon or a dot at the corner of the app icon | [badge](https://ant.design/components/badge) · [avatar](https://ant.design/components/avatar) | [badge basic](https://ant.design/components/badge#badge-demo-basic) · [avatar badge](https://ant.design/components/avatar#avatar-demo-badge) |
| A second small Avatar with the provider icon | Avatar `size` small / a number, `shape`, `icon` | A second, smaller icon beside the title | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) |
| Card `extra` | A ReactNode. `extra` alone also draws the header bar (Card.js renders the head when `title` or `extra` is present) | Text or an icon in the top-right, in a header bar with a line under it | [card](https://ant.design/components/card) | [basic](https://ant.design/components/card#card-demo-basic) |
| Card `title` (+ `extra`) | ReactNode | A header bar with the name; the provider in `extra` | [card](https://ant.design/components/card) | [basic](https://ant.design/components/card#card-demo-basic) |
| Card `actions` | An array of ReactNodes | A bottom bar with items separated by lines | [card](https://ant.design/components/card) | [meta](https://ant.design/components/card#card-demo-meta) |
| Card `cover` | ReactNode | A band across the top of the card (an image or a block) | [card](https://ant.design/components/card) | [meta](https://ant.design/components/card#card-demo-meta) |
| Tooltip on the app icon | `title`, `placement` | Hovering the icon shows the provider | [tooltip](https://ant.design/components/tooltip) | [basic](https://ant.design/components/tooltip#tooltip-demo-basic) |
| Nothing | — | The line is dropped and the description moves up | — | — |

**Not available:** ProComponents `ProCard`, `CheckCard` and `ProList` (no antd 6 support).

Owner's pick: delegated ("vanilla showcase style"). **`Card.Meta` `description` text, as today**, now naming the provider and, for Dify, the type: "Dify · Chatflow" or "AG-UI agent".

---

## E11. The fallback icon per provider

**Used today:** `AppIcon` renders an Avatar with `shape="square"`, `size` large (gallery) or small (table), and an icon chosen by the Dify mode:

| Mode              | Icon                     |
| ----------------- | ------------------------ |
| chat              | `MessageOutlined`        |
| agent-chat, agent | `RobotOutlined`          |
| advanced-chat     | `ApartmentOutlined`      |
| workflow          | `DeploymentUnitOutlined` |
| completion        | `FileTextOutlined`       |
| no mode           | `AppstoreOutlined`       |

**The Avatar around the icon**

| Component | Variant / visual props (allowed values) | What it looks like | Docs | Demo |
| --- | --- | --- | --- | --- |
| Avatar `shape` | circle (the default) / square | A round or rounded-square tile | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) |
| Avatar `size` | small / medium (the default) / large / a number / a responsive object { xs … xxl } | Tile size; a responsive object changes it per screen width | [avatar](https://ant.design/components/avatar) | [basic](https://ant.design/components/avatar#avatar-demo-basic) · [responsive](https://ant.design/components/avatar#avatar-demo-responsive) |
| Avatar `icon` | Any icon below | The icon centred in the tile | [avatar](https://ant.design/components/avatar) | [type](https://ant.design/components/avatar#avatar-demo-type) |
| Avatar letters + `gap` | Text children (e.g. "AG"); `gap` (default 4) | Letters instead of an icon, scaled to fit | [avatar](https://ant.design/components/avatar) | [dynamic](https://ant.design/components/avatar#avatar-demo-dynamic) |
| Avatar background and colour, through tokens | `style` with `theme.useToken()` values, e.g. `colorPrimary`, `colorPrimaryBg`, `colorInfoBg`, `colorSuccessBg`, `colorWarningBg`, `colorFillSecondary`, with `colorTextLightSolid` or `colorPrimary` for the icon (all exist in 6.6.5). Component tokens: `containerSize(LG/SM)`, `iconFontSize(LG/SM)`, `textFontSize` | A tinted tile per provider; the default is grey | [avatar](https://ant.design/components/avatar) | [type](https://ant.design/components/avatar#avatar-demo-type) |
| Icon props | `style` (fontSize, color), `rotate`, `spin`, `twoToneColor` (TwoTone icons only) | The icon's size and colour; two-tone icons get a primary and a light colour | [icon](https://ant.design/components/icon) | [basic](https://ant.design/components/icon#components-icon-demo-basic) · [two-tone](https://ant.design/components/icon#components-icon-demo-two-tone) |
| A custom SVG through `Icon component={…}` | The provider's own logo as an SVG component, wrapped in antd's Icon (the documented "Custom SVG Icon") | The provider's own mark, sized and coloured like the other icons | [icon](https://ant.design/components/icon) | [custom](https://ant.design/components/icon#components-icon-demo-custom) |

**Icon candidates.** Gallery: [ant.design/components/icon#list-of-icons](https://ant.design/components/icon#list-of-icons). The gallery shows the 6.x set, while the project imports 5.6.1. Every name below exists in 5.6.1 with the themes shown, except the ones marked **icons-6 only**. Those need `@ant-design/icons` 6 as a direct dependency (6.3.4 is already in the tree as antd's own copy; two icon majors in the tree are already an open follow-up in CLAUDE.md). 5.6.1 is a strict subset of 6.3.4: no icon was removed.

| For | Icon (themes in 5.6.1) | What the shape suggests |
| --- | --- | --- |
| Dify app | `ApartmentOutlined` | An org chart (today's chatflow icon) |
|  | `DeploymentUnitOutlined` | Linked nodes (today's workflow icon) |
|  | `PartitionOutlined` | A branching tree of boxes |
|  | `ClusterOutlined` | A cluster of connected nodes |
|  | `BranchesOutlined` | Git-style branches |
|  | `NodeIndexOutlined` | Nodes on a line |
|  | `BuildOutlined` / `BuildFilled` / `BuildTwoTone` | Stacked building blocks |
|  | `BlockOutlined` | Two overlapping squares |
|  | `ProductOutlined` / `ProductFilled` | A grid of tiles |
|  | `FunctionOutlined` | The "fx" sign |
| AG-UI agent | `RobotOutlined` / `RobotFilled` | A robot head (today's agent icon) |
|  | `CustomerServiceOutlined` / `Filled` / `TwoTone` | A headset |
|  | `InteractionOutlined` / `Filled` / `TwoTone` | Two arrows in a square |
|  | `ThunderboltOutlined` / `Filled` / `TwoTone` | A lightning bolt |
|  | `ExperimentOutlined` / `Filled` / `TwoTone` | A lab flask |
|  | `BulbOutlined` / `Filled` / `TwoTone` | A light bulb |
|  | `ControlOutlined` / `Filled` / `TwoTone` | Slider controls |
|  | `RocketOutlined` / `Filled` / `TwoTone` | A rocket |
|  | `SisternodeOutlined`, `SubnodeOutlined`, `NodeExpandOutlined` | Node trees, adding a node |
|  | `AimOutlined` | Crosshairs |
|  | `CommentOutlined`, `MessageOutlined` / `Filled` / `TwoTone` | Speech bubbles (`MessageOutlined` is today's chat icon) |
| OpenAI-compatible model | `ApiOutlined` / `ApiFilled` / `ApiTwoTone` | A plug and socket |
|  | `CloudServerOutlined` | A server with a cloud |
|  | `CloudOutlined` / `Filled` / `TwoTone` | A cloud |
|  | `CodeOutlined` / `Filled` / `TwoTone` | The `</>` sign |
|  | `CodeSandboxOutlined` | A cube |
|  | `DatabaseOutlined` / `Filled` / `TwoTone` | Stacked discs |
|  | `HddOutlined` / `Filled` / `TwoTone` | A hard drive |
|  | `FunctionOutlined` | The "fx" sign |
|  | `SendOutlined`, `LinkOutlined` | A paper plane; a chain link |
|  | `OpenAIOutlined` / `OpenAIFilled` | OpenAI's own logo. A server that is merely OpenAI-compatible may not be OpenAI |
|  | **icons-6 only**, `Filled` only: `OllamaFilled`, `MetaFilled`, `MistralFilled`, `QwenFilled`, `DeepSeekFilled`, `GeminiFilled`, `AnthropicFilled`, `ClaudeFilled`, `HuggingFaceFilled`, `ReplicateFilled`, `PerplexityFilled` | Vendor logos, one vendor each |
| Generic app | `AppstoreOutlined` / `Filled` / `TwoTone` | Four squares (today's fallback) |
|  | `AppstoreAddOutlined` | Four squares, one of them a "+" |
|  | `ProductOutlined` / `ProductFilled` | A grid of tiles |
|  | `BlockOutlined`, `BorderOutlined` | Overlapping squares; one square |
|  | `LayoutOutlined` / `Filled` / `TwoTone` | A page layout |
|  | `DesktopOutlined`, `LaptopOutlined` | A screen; a laptop |
|  | `RocketOutlined` / `Filled` / `TwoTone` | A rocket |
|  | `ToolOutlined` / `Filled` / `TwoTone` | A wrench |
|  | `ContainerOutlined` / `Filled` / `TwoTone`, `FolderOutlined` / `Filled` / `TwoTone` | A box; a folder |

**Not available:** `@ant-design/icons` has no Dify or AG-UI logo. Their logos would be brand SVGs used through `Icon component={…}` (the row above). Third-party AI-logo sets such as `@lobehub/icons` need a package.

Owner's pick: delegated ("vanilla showcase style"). The **`Avatar shape="square"`** stays, with its default grey background and today's sizes. One icon per provider:

- Dify: `ApartmentOutlined`;
- AG-UI agent: `RobotOutlined` (Part 2);
- OpenAI-compatible: `ApiOutlined` (later);
- unknown or generic: `AppstoreOutlined`.

All four exist in icons 5.6.1 and 6.3.4. No brand SVGs.
