# Skills used on Image to Colour

## visualize

Used to present the empty upload state and the loaded state together before implementation. The loaded mockup used the supplied Chungking Express still, with hand-picked colours and a sample guide on the yellow swatch. Later, a second visual compared the actual Scene and Accent extraction results across several reference images.

[Read the visualize skill](</Users/guru/.codex/plugins/cache/openai-curated-remote/visualize/1.0.89/skills/visualize/SKILL.md>)

## sites

Used as the local web development workflow. The tool was implemented as a React route in the existing Next.js project. Local preview and browser testing covered the reference photos, image formats, and gradient exports. The work was prepared for your Git and Vercel workflow.

[Read the Sites skill](</Users/guru/.codex/plugins/cache/openai-curated-remote/sites/1.1.4/skills/sites/SKILL.md>)

## animate

Used for the dashed sample guide and the Dock-inspired swatches. The guide and dot move together as the pointer crosses swatches. The swatch lift tapers by distance from the pointer, and the visible face moves inside a fixed click target. Short transitions let both effects change direction as the pointer moves.

[Read the animate skill](</Users/guru/.codex/skills/animate/SKILL.md>)

## animation-accessibility

Used to keep the sampling interaction legible with reduced motion. The guide moves directly to the next sample with reduced motion enabled or when navigating by keyboard. The swatch lift is limited to mouse hover with standard motion preferences.

[Read the animation-accessibility skill](</Users/guru/.codex/skills/animation-accessibility/SKILL.md>)

## gesture-ui

Used to design the draggable sample point. The handle captures the pointer, preserves where you grabbed it, and stays inside the photo. It follows the pointer directly as the nearby colours are resampled. The handle also supports arrow keys.

[Read the gesture-ui skill](</Users/guru/.codex/skills/gesture-ui/SKILL.md>)
