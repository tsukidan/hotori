# Hotori design language

A reusable guide for building new apps with Hotori's visual character. The principles and component behavior are portable; the installer, Discord integration, updater, personal media, and saved user data are not part of the design system.

Use this document with [tokens.css](tokens.css) and the [new-app handoff prompt](NEW-APP-PROMPT.md). The tokens are a starting point, not a complete renderer or component library. No changes to the current app are required to use this guide elsewhere.

## 1. Philosophy

**A personal backdrop, a sculpted glass shell, and a calm, readable working surface.**

The wallpaper supplies atmosphere and a usable accent color. Floating panels establish depth and structure without covering every pixel with opaque rectangles. Glass should feel like a material with thickness and rounded edges. Typography, spacing, and clear states make the app useful even when the wallpaper is visually busy.

The design has six priorities:

1. **Readability leads.** A strong material effect never justifies difficult text or ambiguous controls. Add local tint, acrylic containment, and restrained text shadow before making everything brighter.
2. **Materials express hierarchy.** Use liquid glass for the shell and a few prominent surfaces. Use acrylic for dense content and editing. Use subtle separators and spacing inside those surfaces.
3. **The user's backdrop feels intentional.** Sample a usable accent, preserve image proportions, apply dimming deliberately, and retain a neutral fallback.
4. **Motion explains the interface.** Docks unfold, categories fade, feedback arrives softly, and pressed controls respond. Avoid perpetual movement and exaggerated effects on every element.
5. **Geometry stays coherent.** Align centers, baselines, edges, padding, and control groups. Large radii belong to large surfaces; circular buttons and pill controls have distinct roles.
6. **The experience scales.** Maximized windows use available room, smaller windows remain operable, and keyboard and reduced-motion users receive the same information and actions.

A new app should feel related through these decisions, not through copying Hotori's name, wallpaper, installer layout, or exact number of controls.

## 2. What our liquid glass actually is

### Optical material

Hotori's app uses a WebGL material renderer adapted around the pinned MIT-licensed LiquidGlass library. It composes an application-controlled backdrop from the decoded wallpaper and supported UI contributions, then samples and refracts that scene through rounded glass geometry.

The material combines:

- A curved/beveled surface with a consistent rounded silhouette.
- Refraction that displaces the sampled scene, especially near curved edges.
- Controlled blur and restrained color separation.
- Fresnel/rim lighting, depth shading, subtle tint, and soft cast shadows.
- Sharp native foreground text, icons, inputs, focus rings, and hit targets.

The result depends on the renderer, its scene textures, surface geometry, and layering. A translucent CSS background with `backdrop-filter: blur(...)` is a useful fallback, but it does not reproduce those optical calculations. Shader parameter values are renderer-specific; a `blurAmount` of `0.3` is not a CSS blur of `0.3px`.

The glass does not sample arbitrary applications or the whole desktop. Scene capture is bounded by what the app can compose and the browser can legally sample. Unsupported cross-origin images must not poison the canvas or disable the rest of the material.

### The three material roles

| Material | Appearance and purpose | Typical placement |
| --- | --- | --- |
| Liquid glass | Clearer, refractive, rounded, visibly dimensional; controlled distortion and restrained tint | Main shell, outer settings panes, command dock, major dialogs, selected showcase surfaces |
| Acrylic | Stronger frost, stable tint, little or no optical distortion; easy to read | Settings rows, category controls, menus, dropdown lists, guide cards, dense content and gallery cards |
| Quiet inset surface | Modest translucent fill/border; foreground remains sharp; usually no additional blur pass | Descriptions, grouped metadata, separators, swatch/opacity regions inside an existing surface |

Hotori's working acrylic treatment uses a **24 CSS-pixel blur**, roughly **115% saturation**, and a dark neutral tint. The CSS/fallback reference is `#10121660`; the active compositor has its own acrylic painting and tint passes. These are related implementations, not a guarantee of identical output. In a new app, compare the actual rendered result over several wallpapers.

The main settings shell and sidebar remain liquid glass. Their inner controls are predominantly acrylic. This contrast makes the large surfaces expressive while keeping working content legible. The launcher music player is an intentional liquid-glass exception inside settings, with acrylic transport buttons.

### Layering contract

From back to front:

1. Wallpaper or neutral canvas.
2. Wallpaper dimming/tint, applied once at the intended scene level.
3. The large outer material surfaces.
4. Local acrylic cards or quiet inset regions where content needs containment.
5. Native foreground content, interaction states, and focus outlines.
6. Top-layer dialogs and temporary feedback, when applicable.

Do not multiply the same dimming across nested containers. Do not stack a blur on every row of a surface that should share one continuous backdrop. Do not draw a blurred bitmap of the text over the real text. Material canvases and decorative layers must not intercept pointer events.

### Fallback contract

If WebGL is unavailable or its context is lost, keep layout, focus, controls, content, selection, and readable backgrounds intact. Use a tint/blur or solid readable fallback. A missing effect must never produce invisible controls or prevent app startup.

The Discord True Liquid Glass plugin is a separate integration with a more restricted, wallpaper-only scene. Reusing this app's design language does not require installing that plugin or reproducing its delivery workflow.

## 3. Color and wallpaper

- Use near-white foreground text, with a calmer secondary gray. Current desktop references are `#f5f6f7` and `#cbd0d7`.
- Use dark neutral surfaces, restrained white borders, and soft black shadows. The backdrop can remain colorful without making every control colorful.
- Derive one usable accent from the wallpaper. Hotori samples a small decoded image and favors dominant usable hues rather than near-black, near-white, or weakly saturated pixels. Fall back to a neutral blue-gray when sampling fails.
- Apply the accent consistently to primary actions, selection, focus, slider fill, active indicators, and appropriate update attention states.
- Keep warning/error semantics independent of the accent. Use muted yellow for dependencies/caution and muted red for destructive or experimental/performance warnings. Do not let a red wallpaper make all ordinary controls look destructive.
- Confirm contrast on bright, dark, busy, and nearly monochrome wallpapers. Text shadow supports contrast; it is not a substitute for sufficient local background containment.
- Retain the user's chosen tint, dimming, and image crop. Preview rendering must not silently bake a second tint into the saved source image.

## 4. Typography and iconography

Use **Inter** for functional UI and **Nunito** for the friendly rounded brand/display voice. Bundle appropriate font files and their licenses. If replacing the fonts in a new product, retain the distinction between a readable UI face and a sparingly used expressive display face.

The decorative wordmark is a separate effect: Hotori uses cached glyph distance fields to give letter-shaped glass the same scene and optical foundation as the panel renderer. It is reserved for branding, with controlled white tint for recognition. Ordinary headings and body copy remain normal sharp text.

Desktop reference scale:

| Role | Reference |
| --- | --- |
| Body and form controls | 14px, body line-height 1.5; controls typically weight 600 |
| Help/descriptions | 13px, line-height about 1.65 |
| Metadata and secondary labels | 12px; never the default size for important instructions |
| Section/submenu heading | 16px, line-height about 1.4 |
| Readouts such as slider percentages | 18px, stable/tabular numbers where appropriate |
| Page heading | Responsive 24–30px, line-height about 1.25 |
| Card/preset name | Bold near-white, around 16px, restrained dark text shadow |

Use these as a hierarchy, not a restriction against larger text on touch devices or accessible user scaling. Long prose should have a comfortable reading width, approximately 65 characters per line.

Use consistent outline SVG icons, generally 1.8px strokes. Typical sizes are 16px for tiny window actions, 20–22px for controls, and 26–28px for dock icons. Align icons optically with text. Give icon-only buttons accessible names. Different actions should have distinguishable icons; an installation guide and developer changelog should not look identical.

## 5. Geometry, spacing, and alignment

Use a small spacing family such as **4, 8, 12, 16, 20, 24, 32px**. The exact value follows content density; a consistent system matters more than forcing every current Hotori measurement onto a different app.

Current reference shapes include:

- Large desktop outer panes: approximately 60px radius, with comfortable space around their edges.
- Hero/content glass: roughly 26–36px radius depending on size.
- Settings groups: around 36px; submenus can reach 40px.
- Gallery cards: 22px, with a matching inner clip.
- Smaller inset surfaces: approximately 14–18px.
- Buttons, tabs, dropdown controls: pill geometry where the width supports it.
- Icon buttons: true circles with equal width, height, and minimum dimensions.

For new-app dialogs, 28–40px is a useful compact starting range; large showcase dialogs may use the shell's larger radius. This is a portable recommendation, not a claim that every existing Hotori dialog has the same computed radius.

Match the visible surface, shader clipping, image clipping, hit target, and border radii. A rounded shell with square shader corners looks broken. Do not turn every large title card into a capsule.

Align labels and explanatory text as a readable group. Center swatch groups and previews within their control region. On wider settings rows, keep the descriptive region on the left and the control region on the right. A swatch/color value and its opacity control can share a contained region with a subtle separator. Stack cleanly on smaller screens instead of squeezing controls together.

## 6. Layout and navigation

### Home/overview

Use the wallpaper as the canvas. Place brand and useful summary content in a deliberate readable region. Anchor the action dock to a stable edge, leaving its expansion room. The illustration should not force functional content into the center of a large screen.

### Settings workspace

Use two sibling material panes: a navigation sidebar and a larger content pane. Keep the page header, scrollable body, and action/footer areas distinct. Maximizing expands useful content width; it should not leave a narrow fixed column floating in the middle.

Group navigation by purpose, with a quiet divider and section label for fundamentally different settings. In Hotori, theme settings and launcher settings are separate because they affect different things. A new app should make an equivalent distinction only when its own content needs one.

Maintain category drafts and scroll position where the workflow expects them. Make saving explicit when it affects external configuration; clearly indicate automatic persistence where appropriate. A changed value must enable the correct action immediately.

### Expandable edge dock

The dock has a stable edge and unfolds into available space. The current reference is **76px collapsed / 244px expanded**, with a large rounded shared surface. The desktop right edge stays fixed while expansion moves left.

- Icons remain discoverable while collapsed.
- Hover **or keyboard focus within** expands the dock; labels fade in after expansion starts.
- Nearby icons can gently magnify and separate in response to pointer proximity. This is localized dock behavior, not a hover effect for every row.
- Functional groups have small headings and quiet dividers.
- Related quick controls share one surface and one reveal behavior. Hotori's brightness and volume sliders both appear when either control is hovered or focused.
- Compact height layouts reduce spacing and icon sizes so actions remain reachable.
- Provide an explicit usable expanded state on touch devices. Never make an essential action depend on hover alone.

This focus-expansion rule belongs to the **app dock**. It must not be copied indiscriminately to every hover widget: Hotori's Discord collapsing member list deliberately expands on hover only to avoid Discord's automatic focus changes.

## 7. Component behavior

### Buttons and selection

Use restrained hover brightening, a small press response, clear disabled styling, and persistent keyboard focus outlines. Primary actions borrow the accent without becoming an opaque saturated block. Avoid pointer-following spotlights or dramatic bouncing on ordinary buttons.

Keep **selected**, **applied**, **dirty**, **saving**, **disabled**, and **failed** states semantically distinct. A highlighted preset card means selected; changing the installed configuration still requires Apply. Hotori's preset selection uses a **2px accent border and a larger soft accent glow**. Small navigation controls use a tighter halo.

### Dialogs and confirmation popups

Use a real modal/top-layer primitive, centered within the available window. It has a bounded readable width, a tinted/dimmed backdrop, a clear title, compact explanatory copy, and an understandable action group.

- Keep backdrop and dialog transitions coordinated.
- Keep the optical surface geometry stable during entry/exit; fade the composed result.
- Move focus to the right initial control, trap it within a modal, support Escape when safe, and restore focus on close.
- Destructive confirmation defaults to the safe action and names the item being deleted.
- Errors stay readable in the dialog without losing the user's typed input.
- Preset naming/confirmation dialogs show no scrollbars. Maintain overflow containment and usable scrolling where needed so hidden chrome does not hide actions or content. For long-form dialogs, use an intentional internal scroll region.
- Avoid nesting dialogs or stacking automatic update prompts over an active user workflow.

### Dropdowns and submenus

Treat the control and its opened menu as one material family. The menu gets its own readable acrylic backdrop, correct layering, contained width, rounded clipping, and clear selected state. Test the **open** menu; styling the closed selector alone is insufficient.

For compact selectors such as a changelog version, center the label above a narrower centered control. Dense settings selectors should align with their row. Keep headings bold and near-white, with restrained shadow where needed.

### Sliders, switches, and color controls

Slider fill uses the accent. Labels, values, and endpoints make direction and units understandable; numbers should not jump in width. Use real range inputs with keyboard support.

A control that means brightness must increase brightness toward its maximum; Hotori's current mapping is 0–100 brightness to 80%–0% dimming. A new app may choose its own bounds, but the direction must match the label.

Switches have a clear on/off position as well as color. Optional dependent controls and their warnings reveal softly underneath the relevant selection, retaining the user's preference where changing categories should not erase it.

### Warnings and attention

Use contained tinted backgrounds, a muted semantic border/glow, an outline warning icon, a bold lead sentence, and brief supporting copy. Dependency help uses pale yellow; experimental/performance warnings use muted red. Color alone must not convey the message.

An actionable update indicator can pulse softly in the accent. It should be noticeable without making the whole page flash. Stop nonessential animation for reduced motion and avoid perpetual pulsing on ordinary selected items.

### Galleries, previews, and media

Use a responsive file-gallery grid of acrylic cards, with a stable preview area and bold white names beneath. A blank plus card is an action to create/save an item. A hover-revealed delete button is circular, red acrylic, and uses a lighter red SVG; it must also be accessible through keyboard focus or touch.

Previews represent the user's relevant configuration: wallpaper, colors, crop, and material profile. Example UI uses generic names and fictional content, never captured private account information. Thumbnail optimization must stay separate from saved original image quality.

The media-player pattern centers its transport controls, keeps volume to the side where space allows, places elapsed/total times under opposite ends of the seek bar, and uses clear white bold time text. On compact layouts, stack secondary controls while keeping the main action centered.

### Temporary feedback

A zoom/status pill is small, top-center aligned, and transient. Show it for an actual action such as zoom in/out/reset, then fade it away. It should not sit permanently over the wallpaper. Values remain readable and the pill must not steal focus unnecessarily.

## 8. Motion rules

Reference timings from the current implementation:

| Transition | Reference behavior |
| --- | --- |
| Small feedback/control fades | About 140–220ms |
| Page/category presentation | About 280ms |
| Dialog close/top-layer opacity | About 180ms where discrete transitions are supported |
| Quick-control expansion | About 400ms with a smooth ease-out |
| Dock expansion | About 480ms with restrained spring-like overshoot |
| Skeleton shimmer | About 1.7s, low contrast |

A crucial rendering rule: **compose the material once, then fade its presentation once**. If an outer fade is sampled into a child lens and then the browser fades that lens again, the controls become temporarily washed out or transparent. Do not animate opacity independently on every ancestor and nested glass surface. Keep material geometry stable during page/category entry and fade foreground content or the completed category with a compositor-aware strategy.

Use skeletons that approximate the final layout, reserve its space, contain only generic shapes, and leave when real content is ready. Announce loading through accessible status/`aria-busy`; hide decorative skeleton shapes from assistive technology. Do not delay usable content simply to show an animation.

Honor `prefers-reduced-motion` across navigation, dialogs, dock magnification, skeletons, glow pulses, and card movement. Preserve the state change even when its animation is removed.

## 9. Accessibility, performance, and testing

### Accessibility and usability

- Keep semantics, labels, keyboard operation, focus visibility, and modal focus handling in the native DOM/UI layer.
- Aim for usable contrast and approximately 44px primary interaction targets; small desktop auxiliary controls need suitable spacing and an accessible alternative.
- Support zoom and text scaling. Current Hotori uses Ctrl+wheel, Ctrl+plus/minus, Ctrl+0, and a transient percentage pill. Adapt shortcuts appropriately to the target platform.
- Test long names, errors, missing images, disabled actions, loading states, small heights, wide windows, and keyboard-only use.

### Rendering budget

Share the renderer instead of allocating a WebGL context per control. Cache decoded wallpaper, scene composition, glyph geometry, and expensive snapshots. Bound caches and free resources. Render on invalidation or visible animation rather than spinning an idle loop. Stop off-screen/hidden work, constrain device-pixel ratio and framebuffer sizes, and handle context loss.

Lazy-load galleries and generate small separate thumbnails. Serialize expensive image decoding when appropriate. Prefer a quiet local inset over another blur layer. Avoid capturing an entire scrollable settings page repeatedly during scrolling. Smooth scrolling and prompt input response outrank additional optical detail.

### Visual verification matrix

Check at least:

- Bright, dark, busy, and nearly neutral backgrounds.
- Resting, hovered, focused, pressed, selected, disabled, loading, and error states.
- Closed and open dropdowns; dialog entry/exit and focus return.
- Compact window height, a narrow window, maximized width, and changed zoom.
- Normal and reduced motion.
- WebGL available, unavailable, and context-loss fallback.
- Initial entry and transitions, not only screenshots taken after animations finish.

Verify actual rendered readability. Do not claim accessibility compliance or a frame-rate guarantee solely from having tokens, ARIA attributes, or a passing screenshot test.

## 10. Reusing the language in a new app

1. Copy this guide, `tokens.css`, and `NEW-APP-PROMPT.md` as design references.
2. Define the new app's own tasks, navigation, persistence rules, and platform requirements.
3. Build the structural layout and readable acrylic version first. Validate keyboard and compact-window behavior.
4. Add liquid glass to selected outer surfaces through a material adapter. Keep foreground controls native and one consistent source of geometry/radius.
5. Apply accent sampling, component states, motion, and graceful fallback.
6. Validate the full state matrix. Tune effects against representative backgrounds and hardware.

Do not transplant Hotori's installer/update commands, Vencord integration, product identifiers, signing keys, personal wallpapers/music, or user profiles into another app. Design reuse does not authorize modifying the user's existing installation.

### Implementation map for agents with access to this repo

These files explain the actual implementation; do not copy the entire app merely to get its appearance:

| Concern | Reference |
| --- | --- |
| Layout, dock, settings, warnings, galleries | [styles.css](../../web/styles.css), [index.html](../../web/index.html), [app.js](../../web/app.js) |
| Functional type hierarchy and final overrides | [typography.css](../../web/typography.css) |
| Native CSS optical/fallback materials | [liquid-glass.css](../../web/liquid-glass.css), [liquid-glass.js](../../web/liquid-glass.js) |
| Shared scene/material adapter, clipping and scheduling | [glass-shader.js](../../web/glass-shader.js) |
| Decorative glyph material | [glass-wordmark.js](../../web/glass-wordmark.js) |
| Pinned optical implementation and provenance | [LiquidGlass notice](../../web/vendor/liquidglass/NOTICE.md), [MIT license](../../web/vendor/liquidglass/LICENSE), [html-to-image license](../../web/vendor/liquidglass/html-to-image-LICENSE) |
| Page/category/dialog/loading motion | [app-motion.js](../../web/app-motion.js), [app-motion.css](../../web/app-motion.css) |
| Wallpaper accent and image preview/cropping | [wallpaper-accent.js](../../web/wallpaper-accent.js), [wallpaper-tools.js](../../web/wallpaper-tools.js), [wallpapers.rs](../../src/wallpapers.rs) |
| Zoom and temporary feedback | [ui-zoom.js](../../web/ui-zoom.js) |
| Gallery and media examples | [presets.js](../../web/presets.js), [background-music.js](../../web/background-music.js) |
| Font attribution | [font notices](../../web/assets/fonts/NOTICE.md) |

The current panel renderer is adapted from **ybouane's MIT-licensed LiquidGlass 1.0.3**, pinned and vendored locally; Hotori adds its hierarchy/clipping adapter, bounded capture/cache behavior, styling, interactions, and glyph geometry. Preserve the corresponding source/license notices when reusing that implementation, along with font and bundled dependency notices. Do not describe it as Apple's proprietary renderer or as entirely original Hotori shader code.

For exact visuals, inspect computed styles and the current cascade: the later typography and material styles override some earlier base values. The portable tokens below are deliberately a coherent starting set, not an automatic extraction of every computed Hotori value.
