# Hydrus Bridge for Eagle

Version: 0.1.1 path-detection patch

Hydrus Bridge is an experimental Eagle window plugin that opens a sleek local browser GUI for exporting Eagle tags into Hydrus-compatible `.txt` sidecars.

It is made for this workflow:

1. Select images in Eagle.
2. Run the **Hydrus Bridge** plugin.
3. Your default browser opens to a local GUI.
4. Review each image, output filename, sidecar filename, and sidecar text.
5. Choose a Hydrus pickup/import folder.
6. Export image + `.txt` sidecar pairs.

Default sidecar naming:

```text
image001.jpg
image001.jpg.txt
```

Default sidecar contents:

```text
tag one
tag two
artist:example
```

## Why this is a plugin instead of CSV

The plugin reads Eagle item data directly through Eagle's Plugin API, including `item.tags`, `item.filePath`, and `item.thumbnailPath`. That avoids CSV column guessing and filename mismatch issues.

## Important safety note about "cut/paste"

Eagle stores files inside its own library. Raw-moving those files out of Eagle can break Eagle records.

So Hydrus Bridge does **not** directly move Eagle's internal image files. Instead, the cut-like option is:

> Copy image + sidecar pairs to the Hydrus folder, then move the exported Eagle items to Eagle Trash.

That is safer and reversible.

## Installation / testing

This is an unpacked development plugin.

Recommended test path:

1. Extract this folder somewhere permanent, for example:

```text
D:\Tools\Hydrus Bridge Eagle Plugin
```

2. In Eagle, open the plugin panel.
3. Go to **Developer Options**.
4. Create or load a **Window Plugin**.
5. Use this folder as the plugin folder, or create a Window Plugin and replace its generated files with the files from this folder.
6. Run **Hydrus Bridge** from Eagle's plugin menu.

The small Eagle launcher window must stay open while the browser GUI is active. It is hosting the local bridge server.

## Files

```text
manifest.json
logo.png
index.html
launcher.css
js/launcher.js
browser/index.html
browser/app.css
browser/app.js
```

## Debugging

The plugin has `devTools` enabled in `manifest.json`. With the Eagle plugin window focused, press F12 to open DevTools.

## Current features

- Opens the GUI in your default browser.
- Reads current Eagle selection directly.
- Optional entire-library mode.
- Shows thumbnails, original file paths, tag counts, and editable sidecar text.
- Lets you choose the Hydrus pickup folder using Eagle's native folder dialog.
- Supports overwrite control.
- Can add optional tags from Eagle source URL and rating.
- Can prefix plain Eagle tags with `eagle:`.
- Copies image + sidecar pairs to the target folder.
- Optional safe cut-like cleanup by moving exported Eagle items to Eagle Trash after successful copy.

## Known limitations

- The local browser tab only works while the Eagle plugin launcher window remains open.
- This is a first development build, not a signed Plugin Center package.
- It has not been tested inside your exact Eagle library yet, so test with a small selection first.


## If the browser says Not found

Use version 0.1.1 or newer. The first build assumed Eagle's plugin runtime would set `__dirname` to the `js/` folder. On some Eagle installations it may not, which made the local server look for the browser GUI in the wrong place.

This patched version searches for the plugin root by checking for:

```text
browser/index.html
```

If it still says Not found, the error page should now show the resolved Plugin root and Browser root paths, which makes the issue easier to diagnose.


## Version 0.2.0 popup export animation

This build adds an optional animated export effect in the browser GUI:

- Each successfully exported image appears as a draggable Aero popup card.
- Cards spawn at random positions in the browser window.
- Cards appear one per second.
- Each card plays `browser/sfx/populate.wav` when it appears.
- The generated sidecar text appears one word at a time.
- Each typed word plays `browser/sfx/bloop.wav`.
- Popups can be dragged by their titlebar and closed individually.
- The GUI includes checkboxes to disable popups, sounds, or persistent cards.

The bundled `.wav` files are simple generated placeholder sounds. You can replace them with your own files as long as the names stay:

```text
browser/sfx/populate.wav
browser/sfx/bloop.wav
```


## Version 0.2.1 persistence/timing patch

This build fixes export popup persistence and adjusts the animation pacing:

- Popup cards now remain visible after their typing animation completes.
- The CSS `done` animation now explicitly preserves opacity instead of falling back to the base hidden state.
- Text reveal/bloop pacing is slightly slower: 95ms per word.
- Popup spawn pacing is slightly slower: 1.3 seconds between cards.
- If the “Keep popups on screen after typing” checkbox is present and checked, cards persist until manually closed or cleared.


## Version 0.2.2 close button and ambience patch

This build polishes the popup cards:

- Fixes the close button so the X is centered and drawn with CSS pseudo-elements.
- Adds `browser/sfx/close.wav` for closing popup cards.
- Adds `browser/sfx/bg.wav` for soft background ambience.
- Adds a “Play soft bg ambience” checkbox.
- Background ambience starts when the export popup sequence begins.
- Background ambience stops when popups are cleared, or after auto-fading popups if “Keep popups” is off.

You can replace these sound files with your own:

```text
browser/sfx/populate.wav
browser/sfx/bloop.wav
browser/sfx/close.wav
browser/sfx/bg.wav
```
