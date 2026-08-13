# Design QA: approved marketplace and offer drawer

- Source visual truth: `/Users/konstantin/.codex/generated_images/019e1cc3-ac31-7600-a1aa-099052f281af/exec-179300b1-1b9c-40a1-95b4-439d6eb1fcc1.png`
- Implementation screenshot: `/tmp/beri-final-desktop.png`
- Combined comparison: `/tmp/beri-design-comparison.png`
- Route and state: public marketplace, first current offer drawer open
- Viewport: 1487 x 1058 CSS px, desktop, browser density 1
- Source pixels: 1487 x 1058
- Implementation pixels: 1487 x 1058
- Density normalization: none required; source and implementation have equal pixel dimensions

## Full-view comparison evidence

The combined comparison shows the same primary composition: dark teal utility header, current-day heading and date, horizontal fresh-photo rail, compact offer list, and a fixed right-side detail drawer. The implementation intentionally keeps existing product navigation and uses the project's current test content, while preserving the approved layout and interaction hierarchy.

## Focused region comparison evidence

The right drawer and mobile publishing wizard were checked separately because they contain the primary conversion and partner workflow. The drawer contains the current photo, pickup interval, remaining quantity, price, CTA and trust notes. The mobile wizard was verified at 390 x 844 through photo selection, offer details, conditions, preview and publish.

## Required fidelity surfaces

- Fonts and typography: system sans-serif hierarchy, weights and line heights match the compact operational character of the target; no clipped controls or unreadable labels were observed.
- Spacing and layout rhythm: header, rail, list and drawer tracks are stable; desktop and mobile controls remain in the viewport.
- Colors and visual tokens: deep teal, white, warm yellow stock badges and orange action color follow the target palette with sufficient contrast.
- Image quality and asset fidelity: real raster food photos are used with cover crops; uploaded partner photos are resized and stripped of metadata before storage.
- Copy and content: Armavir, pickup-today, current-photo and pay-at-pickup messaging remain explicit and use test-only venue/address data.

## Comparison history

1. P1: wizard navigation exposed Back and Publish on step one because shared button display overrode `hidden`.
   Fix: added a scoped hidden rule for wizard footer actions and verified only Next remains visible on step one.
2. P1: booking consent could not be checked because the offer drawer overlaid the modal.
   Fix: close the drawer before opening booking and raise the booking modal layer; verified code creation and stock decrement.
3. P2: the desktop marketplace title wrapped excessively with the drawer open.
   Fix: adjusted drawer-open typography and rail sizing; verified at the same 1487 x 1058 state.
4. P2: asynchronous photo processing referenced a cleared event target.
   Fix: retain the input element before awaiting image conversion; build and isolated smoke tests pass.

## Primary interactions tested

- Open and close offer drawer.
- Mobile partner login.
- Add a photo, fill an offer, preview and publish.
- Save and reselect a partner-specific template.
- See the published offer on the public marketplace.
- Create booking code `BS-3915`, decrement stock, see it in the partner cabinet and mark it issued.
- Browser console was checked; the discovered asynchronous upload error was fixed before final verification.

## Follow-up polish

- P3: add a standard icon package in a later dependency-backed design-system pass for calendar, location, camera and sustainability icons.
- P3: add drag ordering for two or three offer photos after the pilot proves partners use multi-photo listings.

final result: passed
