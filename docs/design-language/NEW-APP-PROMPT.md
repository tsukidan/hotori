# New-app design handoff

Copy this file together with `README.md` and `tokens.css` from this folder into a new project. Then give the agent the prompt below, filling in the product details. If you need the actual optical implementation, separately provide the licensed renderer/adapter source and notices referenced by the guide; the three design documents alone do not implement WebGL glass.

---

Build this product using the attached Hotori design-language guide:

- Product and purpose: [describe the new app]
- Target platform and framework: [specify, or inspect the existing project]
- Primary user tasks and required screens: [list]
- Data, persistence, integrations, and deployment constraints: [list]

Read the complete design-language README and its portable tokens before designing. Follow this new project's own instructions and release rules. Reuse Hotori's visual principles and component behavior; use this product's own name, information architecture, assets, and functionality.

The direction is wallpaper-led and atmospheric, with sculpted liquid-glass outer surfaces, readable acrylic working regions, restrained accent color, sharp native text and controls, consistent rounded geometry, and smooth purposeful motion.

Use liquid glass selectively for the shell, a stable edge dock where appropriate, and major surfaces. Settings rows, dropdown menus, dense content, and gallery cards should use readable acrylic. Supporting descriptions need quiet inset containment. Keep the hierarchy clear and avoid stacked blur and repeated dimming.

A CSS blur fallback is not the full optical shader. If implementing optical glass, use the supplied licensed rendering source through an adapter, with a shared renderer, controlled scene capture, matching geometry/clipping, bounded caches, invalidation-driven drawing, and context-loss fallback. Preserve provenance and dependency/font licenses. If the required renderer source is unavailable, make the acrylic fallback useful and explicitly report that optical rendering remains unimplemented.

Use the guide's typography, spacing, color, dock, dialog, dropdown, warning, gallery, media, and motion patterns as a coherent starting point. Adapt them to this product rather than copying the installer screen. A dock expands from a stable edge on hover or keyboard focus, with an explicit touch alternative. Dialogs use real modal semantics, coordinated fades, correct focus handling, retained form input on errors, and safe destructive confirmation. Keep naming dialogs free of visible scrollbar chrome without clipping usable content.

Fade completed material surfaces once; avoid double-fading a captured backdrop through nested lenses. Include useful loading placeholders, transient status feedback, keyboard focus, text scaling, and reduced-motion behavior. Selected items, applied changes, unsaved changes, loading, and errors must remain distinct.

Test bright/dark/busy wallpapers; hover/focus/pressed/selected/disabled/error/loading states; open dropdowns; dialog entry/exit; compact and maximized windows; zoom; reduced motion; and renderer failure. Evaluate interaction and scrolling performance, not only static screenshots.

Do not copy Hotori's updater, signing keys, application identifiers, Discord/Vencord integration, personal wallpaper/music, user profile, or saved presets into this app. Do not access the user's screen without asking. Do not publish or deploy without authorization.

Deliver a working implementation appropriate to this project's build requirements, with a concise account of what was verified and any remaining limitations.
