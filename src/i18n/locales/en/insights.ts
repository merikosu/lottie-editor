/** Strings of the "insights" feature. Keep keys in sync with ../ru/insights.ts (type-checked). */
import { pluralEn } from '../../plural'

/** Pre-formatted issue parameters (numbers and sizes are formatted by the caller). */
type P = Readonly<Record<string, string>>

const issues = {
  'doc.frameRate': {
    title: () => 'Invalid frame rate',
    about: () =>
      'The frame rate must be greater than zero, otherwise players cannot advance the animation.',
  },
  'doc.range': {
    title: () => 'Out point is not after the in point',
    about: () => 'The animation has no frames to play. Set the in and out points in Timing.',
  },
  'doc.size': {
    title: () => 'Invalid canvas size',
    about: () => 'Width and height must be greater than zero.',
  },
  'doc.version': {
    title: (p: P): string =>
      p.value ? `Malformed version “${p.value}”` : 'Missing format version',
    about: (p: P): string =>
      p.value
        ? 'lottie-android expects the version as major.minor.patch and fails to open other forms.'
        : 'lottie-ios refuses to open files without the “v” field.',
  },
  'layer.parentCycle': {
    title: () => 'Parent loop',
    about: () =>
      'Layers are parented to each other in a loop. lottie-web crashes and lottie-android freezes.',
  },
  'asset.cycle': {
    title: (p: P): string => `Precomposition “${p.id}” contains itself`,
    about: () =>
      'Precompositions reference each other in a loop, so players fail to load the file.',
  },
  'asset.missing': {
    title: (p: P): string =>
      p.kind === 'image'
        ? p.id
          ? `Missing image “${p.id}”`
          : 'Image layer without an image'
        : p.id
          ? `Missing precomposition “${p.id}”`
          : 'Precomposition layer without a source',
    about: () =>
      'The layer refers to an asset that does not exist, and lottie-web fails to load the file.',
  },
  'layer.missingTransform': {
    title: () => 'Layer has no transform',
    about: () => 'The “ks” transform is missing; lottie-web fails to load the animation.',
  },
  'layer.missingInOut': {
    title: () => 'Layer has no in and out points',
    about: () => 'lottie-web never shows the layer and lottie-ios refuses to open the file.',
  },
  'layer.missingStart': {
    title: () => 'Layer has no start time',
    about: () =>
      'lottie-ios requires “st” on every layer, and precompositions without it do not play in lottie-web.',
  },
  'shape.missingShapes': {
    title: () => 'Shape layer without a contents list',
    about: () => 'lottie-web fails to load shape layers without “shapes”.',
  },
  'shape.groupNoItems': {
    title: () => 'Group without contents',
    about: () => 'lottie-web fails to load groups without an “it” list.',
  },
  'shape.groupTransform': {
    title: (p: P): string =>
      p.reason === 'missing'
        ? 'Group has no transform'
        : p.reason === 'multiple'
          ? 'Group has several transforms'
          : 'Group transform is not last',
    about: () =>
      'Exporters write exactly one transform as the last item of a group. lottie-web’s standard build fails to load groups without one.',
  },
  'shape.pathMalformed': {
    title: () => 'Malformed path',
    about: () =>
      'Vertex and tangent lists must have the same length; lottie-web fails to load the animation.',
  },
  'shape.internal': {
    title: () => 'Unsupported item “ms”',
    about: () => 'This internal modifier type breaks lottie-web’s SVG renderer.',
  },
  'gradient.stops': {
    title: () => 'Gradient data does not match its stops',
    about: () =>
      'The number of values does not fit the number of color stops; lottie-web fails to load the file.',
  },
  'prop.missing': {
    title: (p: P): string => `${p.label} is missing`,
    about: () =>
      'This property is required on the item; lottie-web fails to load the animation without it.',
  },
  'prop.singleKeyframe': {
    title: () => 'Animated property with one keyframe',
    about: () =>
      'lottie-web cannot evaluate it and skips the layer (the editor preview hides this). A static value looks the same.',
  },
  'prop.missingEasing': {
    title: () => 'Keyframe without easing',
    about: () => 'lottie-web stops drawing the layer; other players fall back to linear motion.',
  },
  'prop.unsorted': {
    title: () => 'Keyframes out of order',
    about: () =>
      'Keyframe times must increase, otherwise players interpolate between the wrong values.',
  },
  'prop.badKeyframe': {
    title: () => 'Damaged keyframes',
    about: () =>
      'Some keyframes are empty or have no time, so players fail on this property. Removing them keeps the valid keyframes.',
  },
  'prop.animatedFlag': {
    title: () => 'Animated flag does not match the keyframes',
    about: () =>
      'The “a” flag says the property is static but it has keyframes, or the other way round. Skottie rejects it and lottie-web’s standard build can fail.',
  },
  'prop.incomplete3d': {
    title: () => 'Incomplete 3D rotation',
    about: () =>
      'The layer has an X rotation but no Y or Z rotation or orientation; lottie-web fails to load it.',
  },
  'prop.splitPosition': {
    title: () => 'Separated position without X or Y',
    about: () =>
      'The position is split into dimensions but one of them is missing; lottie-web fails to load it.',
  },
  'value.nonFinite': {
    title: () => 'Invalid numbers',
    about: () => 'Some values are empty or not a number. Players either fail or treat them as 0.',
  },
  'value.notInteger': {
    title: (p: P): string => `“${p.field}” must be a whole number`,
    about: () =>
      'lottie-android and dotLottie read this field as an integer and fail on fractions.',
  },
  'value.notBoolean': {
    title: (p: P): string => `“${p.field}” must be true or false`,
    about: () =>
      'lottie-android and dotLottie fail when a number is used where true or false is expected.',
  },
  'layer.duplicateInd': {
    title: (p: P): string => `Layers share index ${p.ind}`,
    about: () =>
      'Several layers in one composition have the same “ind”, so parenting and mattes become ambiguous and players resolve them differently.',
  },
  'asset.duplicateId': {
    title: (p: P): string => `Duplicate asset id “${p.id}”`,
    about: () =>
      'Several assets share one id. Players use the first one; the others cannot be reached.',
  },
  'precomp.missingSize': {
    title: () => 'Precomposition layer has no size',
    about: () =>
      'Without w and h lottie-web clips the layer away and lottie-ios refuses to open the file.',
  },
  'image.missingFields': {
    title: () => 'Incomplete image asset',
    about: () => 'lottie-ios requires the path, folder, width and height on every image asset.',
  },
  'matte.noSource': {
    title: () => 'Track matte without a source',
    about: (p: P): string =>
      p.reason === 'parent'
        ? 'The matte refers to a layer that does not exist. lottie-web draws the layer unmasked and its canvas renderer fails.'
        : 'The first layer of a composition cannot use the layer above it as a matte.',
  },
  'matte.sourceFlag': {
    title: () => 'Matte layer is not marked as a matte',
    about: (p: P): string =>
      p.state === 'value'
        ? 'The matte flag must be 1; lottie-web’s canvas renderer draws sources marked otherwise.'
        : 'The layer used as a matte is not flagged as one, so players also draw it as a normal layer.',
  },
  'matte.hiddenSource': {
    title: () => 'Matte layer is hidden',
    about: () =>
      'Hidden matte layers are never rendered, so the layers they matte disappear in lottie-web and dotLottie.',
  },
  'matte.notAdjacent': {
    title: () => 'Matte layer is not directly above',
    about: () =>
      'lottie-android and lottie-ios up to 4.6 ignore the matte link and use the layer directly above, so the wrong layer masks this one.',
  },
  'matte.canvasLookup': {
    title: () => 'Canvas renderer cannot find the matte',
    about: () =>
      'Without an explicit link, lottie-web’s canvas renderer looks for the layer whose index is one less than this one’s.',
  },
  'matte.orphan': {
    title: () => 'Unused matte layer',
    about: () =>
      'The layer is marked as a matte but nothing uses it. lottie-android and older lottie-ios draw it.',
  },
  'matte.explicitVisible': {
    title: () => 'Matte layer is marked visible',
    about: () => 'An explicit “hd: false” makes Skottie draw the matte layer.',
  },
  'mask.flag': {
    title: () => 'Masks are not enabled',
    about: () =>
      'The layer has masks but “hasMask” is not set, so lottie-web draws them distorted.',
  },
  'mask.fields': {
    title: () => 'Mask is missing settings',
    about: () =>
      'Masks need opacity, expansion and a mode. lottie-web fails without them and players disagree on the default mode.',
  },
  'mask.keyOrder': {
    title: () => 'Mask inversion may be lost in dotLottie',
    about: () => 'dotLottie (ThorVG) applies “inv” only when it comes before “mode” in the file.',
  },
  'effect.disabled': {
    title: (p: P): string =>
      p.state === 'off' ? 'Disabled effect' : 'Effect is not marked enabled',
    about: (p: P): string =>
      p.state === 'off'
        ? 'lottie-web renders disabled effects anyway while dotLottie skips them, so the results differ.'
        : 'dotLottie skips effects without an enabled flag.',
  },
  'effect.keyOrder': {
    title: () => 'Effect may be dropped by dotLottie',
    about: () => 'dotLottie (ThorVG) needs the effect type before its values in the file.',
  },
  'layer.keyOrder3d': {
    title: () => '3D rotation may be lost in dotLottie',
    about: () =>
      'dotLottie (ThorVG) reads 3D rotations only when “ddd” comes before the transform in the file.',
  },
  'text.noFonts': {
    title: () => 'Text without a font list',
    about: () => 'lottie-web fails to load text layers when the file has no font list.',
  },
  'text.emptyChars': {
    title: () => 'Empty glyph list',
    about: () =>
      'An empty “chars” list makes lottie-web look for embedded glyphs, so every text layer is blank.',
  },
  'text.unknownFont': {
    title: (p: P): string => `Font “${p.font}” is not in the font list`,
    about: () => 'lottie-web falls back to the first listed font; other players may fail.',
  },
  'text.missingGlyphs': {
    title: (p: P): string => `Missing glyphs: ${p.chars}`,
    about: (p: P): string =>
      `The file embeds glyphs for “${p.font}” but not for these characters, so lottie-web and lottie-android leave them blank.`,
  },
  'text.newline': {
    title: () => 'Line breaks use \\n',
    about: () =>
      'lottie-web breaks lines only on \\r, so the text shows on one line (the editor preview hides this).',
  },
  'telegram.size': {
    title: (p: P): string => `Canvas is ${p.width} × ${p.height}, not 512 × 512`,
    about: () => 'Telegram animated stickers must be exactly 512 × 512.',
  },
  'telegram.fps': {
    title: (p: P): string => `${p.fps} fps instead of 60`,
    about: () => 'Telegram animated stickers must play at 60 fps.',
  },
  'telegram.duration': {
    title: (p: P): string => `Longer than 3 seconds (${p.seconds} s)`,
    about: () => 'Telegram animated stickers can be at most 3 seconds long.',
  },
  'telegram.fileSize': {
    title: (p: P): string => `${p.bytes} compressed, over 64 KB`,
    about: () => 'A .tgs sticker must be at most 64 KB after compression. Optimize can help.',
  },
  compat: {
    title: () => '',
    about: () => '',
  },
  'layer.parentMissing': {
    title: (p: P): string => `Parent layer ${p.ind} not found`,
    about: () =>
      'No layer in this composition has that index, so players ignore the link. Parents must be in the same composition.',
  },
  'layer.missingInd': {
    title: () => 'Layer has no index',
    about: () =>
      'Without “ind” the layer cannot be a parent or a matte, and players assign different defaults.',
  },
  'layer.stretchZero': {
    title: () => 'Time stretch is 0%',
    about: () => 'lottie-web treats it as 100%; other players may divide by zero.',
  },
  'layer.neverVisible': {
    title: (p: P): string =>
      p.reason === 'empty' ? 'Layer has no duration' : 'Layer is outside the timeline',
    about: (p: P): string =>
      p.reason === 'empty'
        ? 'Its out point is not after its in point, so it is never drawn.'
        : 'Its in and out points fall outside the frames that are played, so it is never drawn. Optimize can remove it.',
  },
  'shape.vertexCount': {
    title: () => 'Path morph changes the point count',
    about: () =>
      'Path keyframes have different numbers of points, so the shape morphs unpredictably.',
  },
  'image.external': {
    title: (p: P): string =>
      p.kind === 'url' ? 'Image loaded from a URL' : 'Image is not embedded',
    about: (p: P): string =>
      p.kind === 'url'
        ? 'The image is downloaded when the animation plays; it does not show offline or if the address changes.'
        : 'The image is a separate file. It shows only if shipped next to the JSON. Embed it or export as .lottie.',
  },
  'image.huge': {
    title: (p: P): string => `Large image (${p.bytes})`,
    about: () =>
      'Big embedded images slow down loading and use a lot of memory on phones. Optimize can downscale them.',
  },
  'image.aspect': {
    title: () => 'Image proportions do not match',
    about: (p: P): string =>
      `The asset is declared as ${p.declared} but the image is ${p.actual}. lottie-android stretches it and lottie-web crops it.`,
  },
  'image.oversized': {
    title: (p: P): string => `Image larger than needed (${p.actual})`,
    about: (p: P): string => `It is displayed at ${p.declared}. Optimize can downscale it.`,
  },
  'shape.emptyLayer': {
    title: () => 'Empty shape layer',
    about: () => 'The layer contains no paths, so it draws nothing. Optimize can remove it.',
  },
  'asset.unused': {
    title: () => 'Unused assets',
    about: () =>
      'These precompositions and images are not used by any layer; they only add to the file size.',
  },
  'prop.legacyKeyframes': {
    title: () => 'Legacy keyframe format',
    about: () =>
      'Keyframes store end values as in exporters before 2018. Players still read them; converting keeps the file clean.',
  },
  'doc.legacyVersion': {
    title: (p: P): string =>
      p.colors === '1'
        ? `Old format with 0–255 colors (${p.version})`
        : `Old exporter version (${p.version})`,
    about: (p: P): string =>
      p.colors === '1'
        ? 'Files exported before Bodymovin 4.1.9 store colors as 0–255. lottie-web converts them, but other tools may show wrong colors.'
        : 'Exported with Bodymovin 4. Players handle it, but newer features and fixes are missing.',
  },
  'perf.fileSize': {
    title: (p: P): string => `Large file (${p.bytes})`,
    about: () => 'Large files take longer to download and parse. Optimize can reduce the size.',
  },
  'perf.layers': {
    title: (p: P): string => `Many layers (${p.count})`,
    about: () =>
      'Every layer costs time on each frame, especially on phones. Merge shapes or remove hidden and unused layers.',
  },
  'perf.masks': {
    title: (p: P): string => `Many masks (${p.count})`,
    about: () =>
      'Masks are expensive to render on every frame, especially in lottie-web and on Android.',
  },
  'perf.keyframes': {
    title: (p: P): string => `Many keyframes (${p.count})`,
    about: () =>
      'Baked animations are large and slow to parse. Optimize can merge keyframes that change nothing.',
  },
  'perf.frames': {
    title: (p: P): string => `Long animation (${p.frames} frames)`,
    about: () =>
      'Long animations use more memory in players that cache frames and take longer to export as video.',
  },
  'perf.canvas': {
    title: (p: P): string => `Very large canvas (${p.width} × ${p.height})`,
    about: () =>
      'Mattes and effects need offscreen buffers of the canvas size, which can exhaust memory on phones.',
  },
}

const features = {
  'layer.precomp': { name: 'Precompositions', about: 'Layers that nest another composition.' },
  'layer.solid': { name: 'Solid layers', about: 'Layers filled with one color.' },
  'layer.image': { name: 'Image layers', about: 'Layers showing a bitmap image.' },
  'layer.null': { name: 'Null layers', about: 'Invisible layers used as parents.' },
  'layer.shape': { name: 'Shape layers', about: 'Vector shape layers.' },
  'layer.text': { name: 'Text layers', about: 'Layers that render text.' },
  'layer.audio': {
    name: 'Audio layers',
    about: 'Sound is played only when the host app provides an audio player.',
  },
  'layer.camera': {
    name: '3D camera',
    about:
      'lottie-web’s SVG and canvas renderers refuse to load files with a camera; other players ignore it.',
  },
  'layer.data': {
    name: 'Data layers',
    about: 'Only used by expressions; players without expressions ignore them.',
  },
  'layer.unsupportedType': {
    name: 'Unsupported layer types',
    about: 'Adjustment, guide, light and video layers are drawn as empty layers.',
  },
  'layer.hidden': { name: 'Hidden layers', about: 'Layers switched off with the eye.' },
  'layer.motionBlur': { name: 'Motion blur', about: 'No player renders motion blur.' },
  'text.glyphs': {
    name: 'Text with embedded glyphs',
    about:
      'lottie-ios ignores embedded glyphs and draws the font, falling back to a system font when it is missing.',
  },
  'text.fonts': {
    name: 'Text that needs fonts',
    about:
      'The text is drawn with a font rather than embedded glyphs. lottie-android fails without the font file, lottie-web’s canvas renderer shows nothing, and other players substitute fonts.',
  },
  'text.animators': {
    name: 'Text animators',
    about: 'lottie-android supports only the first range selector; lottie-ios supports a subset.',
  },
  'text.path': {
    name: 'Text on a path',
    about: 'lottie-ios and lottie-android draw the text on a straight line.',
  },
  'time.remap': { name: 'Time remapping', about: 'Precompositions whose time is remapped.' },
  'time.stretch': {
    name: 'Time stretch',
    about: 'Layers played faster or slower than their composition.',
  },
  'transform.3d': {
    name: '3D layers',
    about: 'Most players flatten 3D layers: rotations work, perspective and cameras do not.',
  },
  'transform.autoOrient': {
    name: 'Auto-orient',
    about: 'lottie-ios does not rotate layers along their motion path.',
  },
  'transform.layerSkew': {
    name: 'Layer skew',
    about: 'lottie-ios ignores skew on layer transforms.',
  },
  'blend.basic': { name: 'Blend modes', about: 'Multiply, screen, overlay, darken and lighten.' },
  'blend.advanced': {
    name: 'Advanced blend modes',
    about: 'lottie-android draws dodge, burn, light, difference and color modes as normal.',
  },
  'blend.add': { name: 'Add blend mode', about: 'lottie-web and lottie-ios draw it as normal.' },
  'blend.hardMix': { name: 'Hard mix blend mode', about: 'Only Skottie renders it.' },
  'blend.shape': {
    name: 'Blend modes on shapes',
    about: 'Only lottie-web’s SVG renderer and dotLottie apply blend modes to shape items.',
  },
  'matte.alpha': { name: 'Alpha mattes', about: 'Track mattes using transparency.' },
  'matte.alphaInverted': {
    name: 'Inverted alpha mattes',
    about: 'Track mattes using inverted transparency.',
  },
  'matte.luma': {
    name: 'Luma mattes',
    about:
      'lottie-ios and lottie-android do not support luma mattes: the layer shows unmasked and the matte may appear.',
  },
  'matte.lumaInverted': {
    name: 'Inverted luma mattes',
    about:
      'lottie-web’s SVG renderer, lottie-ios and lottie-android break on inverted luma mattes.',
  },
  'matte.parent': { name: 'Linked mattes', about: 'Mattes that name their source layer.' },
  'matte.nested': {
    name: 'Nested mattes',
    about:
      'A matte layer that has a matte of its own. Players ignore the inner matte or draw it visibly.',
  },
  'mask.any': { name: 'Masks', about: 'Layer masks.' },
  'mask.add': { name: 'Add masks', about: 'Masks in add mode.' },
  'mask.subtract': {
    name: 'Subtract masks',
    about:
      'lottie-web’s canvas renderer ignores the mode and clips to the path, the opposite of the intent.',
  },
  'mask.intersect': {
    name: 'Intersect masks',
    about: 'lottie-web’s canvas renderer treats several of them as add.',
  },
  'mask.lightenDarken': {
    name: 'Lighten and darken masks',
    about: 'Most players draw them as add; Skottie skips them.',
  },
  'mask.difference': {
    name: 'Difference masks',
    about: 'Most players draw them as add or intersect.',
  },
  'mask.inverted': {
    name: 'Inverted masks',
    about: 'lottie-web’s canvas renderer depends on the path direction.',
  },
  'mask.opacity': {
    name: 'Mask opacity',
    about: 'lottie-web’s canvas renderer ignores mask opacity.',
  },
  'mask.expansion': {
    name: 'Mask expansion',
    about: 'lottie-ios, lottie-android, Skottie and the canvas renderer ignore it.',
  },
  'mask.feather': { name: 'Mask feather', about: 'Only Skottie renders feathered masks.' },
  'paint.polystar': { name: 'Stars and polygons', about: 'Polystar shapes.' },
  'paint.gradient': { name: 'Gradients', about: 'Gradient fills and strokes.' },
  'paint.gradientStroke': { name: 'Gradient strokes', about: 'Strokes painted with a gradient.' },
  'paint.gradientOpacity': {
    name: 'Gradient transparency',
    about: 'lottie-web’s canvas renderer ignores opacity stops that do not match the color stops.',
  },
  'paint.strokeDash': { name: 'Dashed strokes', about: 'Strokes with dashes.' },
  'paint.fillRuleEvenOdd': { name: 'Even-odd fill rule', about: 'Fills using the even-odd rule.' },
  'paint.hiddenShape': { name: 'Hidden shapes', about: 'Shape items switched off.' },
  'mod.trim': { name: 'Trim paths', about: 'Trimmed paths.' },
  'mod.trimIndividually': {
    name: 'Individual trim paths',
    about:
      'lottie-ios trims paths separately in its fast engine even when they should trim together.',
  },
  'mod.repeater': {
    name: 'Repeaters',
    about: 'lottie-ios supports repeaters only in its Core Animation engine.',
  },
  'mod.roundCorners': {
    name: 'Round corners',
    about: 'lottie-ios cannot round combined shapes in its fast engine.',
  },
  'mod.mergePaths': {
    name: 'Merge paths',
    about:
      'Ignored by lottie-web, lottie-ios and dotLottie, and off by default in lottie-android: shapes are drawn separately.',
  },
  'mod.offsetPath': {
    name: 'Offset paths',
    about: 'lottie-ios and lottie-android ignore offset paths.',
  },
  'mod.zigZag': { name: 'Zig zag', about: 'lottie-ios, lottie-android and Skottie ignore it.' },
  'mod.puckerBloat': {
    name: 'Pucker and bloat',
    about: 'lottie-ios and lottie-android ignore it.',
  },
  'mod.twist': { name: 'Twist', about: 'No player renders twist.' },
  'fx.any': { name: 'Effects', about: 'Layer effects.' },
  'fx.expressionControls': {
    name: 'Expression controls',
    about: 'Sliders and other controls read by expressions.',
  },
  'fx.tint': {
    name: 'Tint effect',
    about: 'Rendered only by lottie-web’s SVG renderer, dotLottie and Skottie.',
  },
  'fx.fill': {
    name: 'Fill effect',
    about: 'Rendered only by lottie-web’s SVG renderer, dotLottie and Skottie.',
  },
  'fx.stroke': {
    name: 'Stroke effect',
    about: 'Partly rendered by lottie-web’s SVG renderer and dotLottie only.',
  },
  'fx.tritone': {
    name: 'Tritone effect',
    about: 'Rendered only by lottie-web’s SVG renderer, dotLottie and Skottie.',
  },
  'fx.levels': {
    name: 'Levels effect',
    about: 'Rendered only by lottie-web’s SVG renderer and Skottie.',
  },
  'fx.dropShadow': {
    name: 'Drop shadow effect',
    about:
      'lottie-web’s canvas renderer ignores it; lottie-android applies it per fill and stroke.',
  },
  'fx.gaussianBlur': {
    name: 'Gaussian blur',
    about:
      'lottie-ios and lottie-web’s canvas renderer ignore it; lottie-android blurs each fill and stroke.',
  },
  'fx.transform': {
    name: 'Transform effect',
    about: 'lottie-ios, lottie-android and dotLottie ignore it.',
  },
  'fx.setMatte': { name: 'Set Matte effect', about: 'Only lottie-web’s SVG renderer applies it.' },
  'fx.skottieOnly': { name: 'Skottie-only effects', about: 'Only Skottie renders these effects.' },
  'fx.unknown': { name: 'Unsupported effects', about: 'No player renders these effects.' },
  'style.dropShadow': {
    name: 'Drop shadow style',
    about: 'Only lottie-ios and Skottie render layer styles.',
  },
  'style.other': {
    name: 'Layer styles',
    about: 'Glows, bevels, overlays and strokes: only Skottie renders some of them.',
  },
  expressions: {
    name: 'Expressions',
    about:
      'Evaluated by lottie-web and, partly, by dotLottie. lottie-ios, lottie-android and Skottie use the value without the expression.',
  },
  slots: {
    name: 'Slots',
    about: 'lottie-ios and lottie-android ignore slots and use the default values.',
  },
  'image.external': { name: 'External images', about: 'Images stored as separate files.' },
  'image.sequence': { name: 'Image sequences', about: 'Frame-by-frame image sequences.' },
}

const insights = {
  panel: {
    label: 'Issues',
    errors: (n: number) => pluralEn(n, 'error', 'errors'),
    warnings: (n: number) => pluralEn(n, 'warning', 'warnings'),
    infos: (n: number) => pluralEn(n, 'note', 'notes'),
    checking: 'Checking…',
    stale: 'Updating…',
    failed: 'Could not check the animation',
    failedHint:
      'The checker stopped on data it could not read. The animation itself is not changed.',
    retry: 'Check again',
    target: 'Players to check',
    noIssues: 'No issues found',
    compatibleAll: 'Works in all players',
    compatibleWith: (target: string) => `Works in ${target}`,
    fixAll: 'Fix all',
    fixAllHint: (n: number) =>
      `Applies ${pluralEn(n, 'fix', 'fixes')} that don’t change how the animation looks. One undo step.`,
    groups: { error: 'Errors', warning: 'Warnings', info: 'Notes' },
    show: 'Show',
    showAll: 'Select all',
    fix: 'Fix',
    changesLook: 'May change how the animation looks in some players',
    document: 'Animation',
    inLayers: (n: number) => `in ${pluralEn(n, 'layer', 'layers')}`,
    places: (n: number) => pluralEn(n, 'place', 'places'),
    placesInLayers: (places: number, layers: number) =>
      `${pluralEn(places, 'place', 'places')} in ${pluralEn(layers, 'layer', 'layers')}`,
    assets: (n: number) => pluralEn(n, 'asset', 'assets'),
    notListed: (n: number) => `and ${n} more`,
    copyDetails: 'Copy description',
    showInJson: 'Show in JSON',
    players: 'Players',
    moreChips: (n: number) => `+${n}`,
    playerVerdict: (player: string, verdict: string) => `${player}: ${verdict}`,
  },
  targets: {
    all: 'All players',
    web: 'Web',
    ios: 'iOS',
    android: 'Android',
    dotlottie: 'dotLottie',
    telegram: 'Telegram stickers',
  },
  /** Right-aligned hints in the target menu (player names, not translated). */
  targetHints: {
    all: '',
    web: 'lottie-web',
    ios: 'lottie-ios',
    android: 'lottie-android',
    dotlottie: 'ThorVG',
    telegram: '.tgs',
  },
  players: {
    'web-svg': { short: 'Web', full: 'lottie-web (SVG renderer)' },
    'web-canvas': { short: 'Canvas', full: 'lottie-web (canvas renderer)' },
    'web-html': { short: 'HTML', full: 'lottie-web (HTML renderer)' },
    ios: { short: 'iOS', full: 'lottie-ios' },
    android: { short: 'Android', full: 'lottie-android' },
    thorvg: { short: 'dotLottie', full: 'dotLottie players (ThorVG)' },
    skottie: { short: 'Skottie', full: 'Skottie (Skia)' },
    telegram: { short: 'Telegram', full: 'Telegram stickers' },
  },
  /** What a support level means for a player. */
  levels: {
    y: 'Works',
    x: 'Breaks: fails to load or draws wrong content',
    n: 'Ignored: the rest of the animation plays without it',
    p: 'Partly supported',
    '?': 'Not verified',
  },
  /** One-word support levels (player lists and chips). */
  verdicts: { y: 'Works', x: 'Breaks', n: 'Ignored', p: 'Partial', '?': 'Unverified' },
  telegramRejected: 'Not allowed in animated stickers',
  /** Short verdict for Telegram's 'x' (the sticker is rejected rather than broken). */
  verdictRejected: 'Not allowed',
  severity: { error: 'Error', warning: 'Warning', info: 'Note' },
  issues,
  features,
  fixes: {
    setVersion: 'Set a valid version',
    breakParentCycle: 'Break the loop',
    removeParent: 'Remove parent link',
    renumberInd: 'Renumber layers',
    assignInd: 'Assign indices',
    resetStretch: 'Set stretch to 100%',
    addStart: 'Set start time to 0',
    addInOut: 'Use the animation range',
    addTransform: 'Add default transform',
    removeUnusedAssets: 'Remove unused assets',
    renameDuplicateAsset: 'Rename duplicates',
    addPrecompSize: 'Use the composition size',
    completeImage: 'Complete image fields',
    addShapes: 'Add an empty list',
    addGroupItems: 'Add contents',
    fixGroupTransform: 'Fix group transform',
    repairPath: 'Repair tangents',
    removeItem: 'Remove item',
    addDefaultProperty: 'Add default value',
    makeStatic: 'Make static',
    addEasing: 'Add linear easing',
    sortKeyframes: 'Sort keyframes',
    removeBadKeyframes: 'Remove damaged keyframes',
    syncAnimatedFlag: 'Correct the flag',
    upgradeKeyframes: 'Convert keyframes',
    complete3d: 'Add missing rotations',
    zeroNonFinite: 'Replace with 0',
    roundIntegers: 'Round',
    toBoolean: 'Convert to true / false',
    setMatteParent: 'Link the matte layer',
    flagMatteSource: 'Mark as matte',
    moveMatteSource: 'Move matte layer above',
    removeOrphanMatte: 'Delete the layer',
    unhideMatteSource: 'Unhide matte layer',
    dropVisibleFlag: 'Remove the flag',
    setHasMask: 'Enable masks',
    completeMask: 'Add default settings',
    reorderKeys: 'Reorder fields',
    enableEffect: 'Mark as enabled',
    removeDisabledEffect: 'Remove the effect',
    removeChars: 'Remove the empty list',
    lineBreaks: 'Convert line breaks',
    removeExpressions: 'Remove expressions',
    removeCameras: 'Remove camera',
  },
  /** Buttons that open another tool for issues without an automatic fix. */
  actions: {
    resize: 'Resize…',
    timing: 'Timing…',
    optimize: 'Optimize…',
    locate: 'Locate…',
    fonts: 'Show fonts',
  },
  /** Names used in locations ("Layer › Group › Fill › Color"). */
  props: {
    transform: 'Transform',
    a: 'Anchor point',
    p: 'Position',
    s: 'Scale',
    r: 'Rotation',
    o: 'Opacity',
    sk: 'Skew',
    sa: 'Skew axis',
    rx: 'X rotation',
    ry: 'Y rotation',
    rz: 'Z rotation',
    or: 'Orientation',
    x: 'X position',
    y: 'Y position',
    tm: 'Time remap',
    size: 'Size',
    roundness: 'Roundness',
    path: 'Path',
    color: 'Color',
    width: 'Width',
    colors: 'Colors',
    start: 'Start',
    end: 'End',
    startPoint: 'Start point',
    endPoint: 'End point',
    highlight: 'Highlight length',
    highlightAngle: 'Highlight angle',
    offset: 'Offset',
    copies: 'Copies',
    startOpacity: 'Start opacity',
    endOpacity: 'End opacity',
    radius: 'Radius',
    points: 'Points',
    outerRadius: 'Outer radius',
    innerRadius: 'Inner radius',
    outerRoundness: 'Outer roundness',
    innerRoundness: 'Inner roundness',
    dashes: 'Dashes',
    amount: 'Amount',
    miterLimit: 'Miter limit',
    angle: 'Angle',
    center: 'Center',
    ridges: 'Ridges',
    expansion: 'Expansion',
    feather: 'Feather',
    sourceText: 'Source text',
    textPath: 'Text path',
    value: 'Value',
    glyphs: 'Glyphs',
    fonts: 'Fonts',
    slots: 'Slots',
    mask: (n: number) => `Mask ${n}`,
    effect: (n: number) => `Effect ${n}`,
    style: (n: number) => `Style ${n}`,
    animator: (n: number) => `Animator ${n}`,
    keyframe: (n: number) => `Keyframe ${n}`,
    font: (n: number) => `Font ${n}`,
    precomp: (name: string) => `Precomp “${name}”`,
    image: (name: string) => `Image “${name}”`,
    asset: (name: string) => `Asset “${name}”`,
  },
  stats: {
    title: 'Statistics',
    layers: 'Layers',
    shapes: 'Shapes',
    keyframes: 'Keyframes',
    animated: 'Animated',
    precomps: 'Precomps',
    images: 'Images',
    size: 'Size',
    gzip: 'Gzip',
    duration: 'Duration',
    frames: 'Frames',
    features: 'Uses',
    layersHint: (breakdown: string) => `Layers in every composition: ${breakdown}`,
    hidden: (n: number) => `${n} hidden`,
    shapesHint: (groups: number) => `Shape items, including ${pluralEn(groups, 'group', 'groups')}`,
    keyframesHint: (props: number) =>
      `Keyframes of ${pluralEn(props, 'animated property', 'animated properties')}`,
    animatedHint: (total: number) => `Properties with keyframes (of ${total})`,
    precompsHint: (instances: number) =>
      `Precompositions, placed ${pluralEn(instances, 'time', 'times')}`,
    imagesHint: (embedded: number, linked: number) => `${embedded} embedded · ${linked} linked`,
    sizeHint: 'Minified JSON, as it is exported',
    gzipHint: 'Compressed: roughly what a web server sends',
    durationHint: (frames: number, fps: string) =>
      `${pluralEn(frames, 'frame', 'frames')} at ${fps} fps`,
    selectLayers: (n: number) => `Click to select ${pluralEn(n, 'layer', 'layers')}`,
    optimize: 'Optimize file size…',
    chips: {
      masks: 'Masks',
      mattes: 'Mattes',
      gradients: 'Gradients',
      trimPaths: 'Trim paths',
      repeaters: 'Repeaters',
      mergePaths: 'Merge paths',
      text: 'Text',
      images: 'Images',
      expressions: 'Expressions',
      effects: 'Effects',
      layerStyles: 'Layer styles',
      threeD: '3D',
      timeRemap: 'Time remap',
      blendModes: 'Blend modes',
      cameras: 'Cameras',
      audio: 'Audio',
      slots: 'Slots',
    },
    chipHints: {
      masks: (n: number) => pluralEn(n, 'mask', 'masks'),
      mattes: (n: number) => `${pluralEn(n, 'layer', 'layers')} with a track matte`,
      gradients: (n: number) =>
        pluralEn(n, 'gradient fill or stroke', 'gradient fills and strokes'),
      trimPaths: (n: number) => pluralEn(n, 'trim paths modifier', 'trim paths modifiers'),
      repeaters: (n: number) => pluralEn(n, 'repeater', 'repeaters'),
      mergePaths: (n: number) => pluralEn(n, 'merge paths item', 'merge paths items'),
      text: (n: number) => pluralEn(n, 'text layer', 'text layers'),
      images: (n: number) => pluralEn(n, 'image layer', 'image layers'),
      expressions: (n: number) => pluralEn(n, 'expression', 'expressions'),
      effects: (n: number) => pluralEn(n, 'effect', 'effects'),
      layerStyles: (n: number) => pluralEn(n, 'layer style', 'layer styles'),
      threeD: (n: number) => pluralEn(n, '3D layer', '3D layers'),
      timeRemap: (n: number) => `${pluralEn(n, 'layer', 'layers')} with time remapping`,
      blendModes: (n: number) => pluralEn(n, 'blend mode', 'blend modes'),
      cameras: (n: number) => pluralEn(n, 'camera', 'cameras'),
      audio: (n: number) => pluralEn(n, 'audio layer', 'audio layers'),
      slots: (n: number) => pluralEn(n, 'slot', 'slots'),
    },
  },
  size: {
    label: (raw: string, gzip: string) => `${raw} · ${gzip} gzip`,
    title: 'File size',
    json: 'JSON',
    data: 'Animation data',
    images: (n: number) => `Embedded ${pluralEn(n, 'image', 'images')}`,
    gzip: 'Gzip',
    gzipHint: 'What a web server sends. dotLottie files compress about the same.',
    optimize: 'Click to optimize',
    measuring: 'Measuring…',
  },
  indicator: {
    none: 'No issues',
    label: (summary: string) => `Issues: ${summary}`,
    tooltip: (summary: string) => `${summary} · Show issues`,
    noneTooltip: 'No issues found · Show issues',
  },
  commands: {
    issues: 'Show issues',
    fixAll: 'Fix all safe issues',
  },
  history: {
    fix: (title: string) => `Fix: ${title}`,
    fixAll: (n: number) => `Fix ${pluralEn(n, 'issue', 'issues')}`,
  },
}

export default insights
