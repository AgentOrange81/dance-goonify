# Composite + capture research (dance.goonify.fun)

## Agent assistant message 6

 Here's a standalone summary of the four sub-questions. I'll keep it tight: heuristics, concrete code patterns, and known failure modes. --- ## 1. Color matching that doesn't break on bad samples The core problem with Reinhard (and with mean/std transfer in lαβ) is that it assumes the source sample is representative of the whole patch. When it isn't (shadow, rim light, hair, etc.), the transfer either crushes the user's face or tints it teal. **Concrete rules:** 1. **Sample a small, central sub-rectangle — not the full oval.** Use an inset bounding rect equal to 60–80% of the oval's shorter dim …(+3280 chars)

## Agent assistant message 8

 the camera matrix. This is the only library that does it right. - **OpenCV face alignment** uses **affine (6 DOF)** with3 points (eyes + nose or mouth-center). Better than face-api's 4-point similarity, but still no perspective. **Adding 3 more landmarks gets you *close* but not all the way:** With 5 landmarks (left eye, right eye, nose tip, left mouth, right mouth) you can solve an **affine transform** that accounts for the 3/4 rotation better than 4-point similarity, but the perspective distortion of the far cheek vs. the near cheek is still wrong. To get true perspective with 5 points, you  …(+3375 chars)
15:11:02 think    | Here's a standalone summary of the four sub-questions. I'll keep it tight: heuri

## Agent assistant message 9

 that work in browsers right now:** ```js // VP9 in WebM — best quality, ~30% smaller than VP8, broad supportconst mime = 'video/webm;codecs=vp9,opus'; // VP8 fallback — universal support, slightly larger files const mime = 'video/webm;codecs=vp8,opus'; // H.264 baseline profile in MP4 — Safari/iOS native, Chrome130+, Firefox experimental const mime = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'; // H.264 + no audio const mime = 'video/mp4;codecs=avc1.42E01E'; ``` **Pick with a probe, don't hardcode:** ```js function pickMime() { const candidates = [ 'video/webm;codecs=vp9,opus', 'video/webm;codecs …(+2190 chars)
15:11:05 final    | status=completed duration=143.94s summary: Here's a standalone summary of the four sub-questions. I'll keep it tight: heuristics, concrete code patterns, and known failure modes. --- ## 1. Color matching that doesn't break on bad samples The core problem with Reinhard (and with mean/std transfer in lαβ) is that it assumes the source sample is representative of the whole patch. When it isn't (shadow, rim light, hair, etc.), the transfer eit …(+94 chars)
15:11:05 final    | end status=completed exit_reason=completed


