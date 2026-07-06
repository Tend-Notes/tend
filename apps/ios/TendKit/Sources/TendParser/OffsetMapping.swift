// SPDX-License-Identifier: MIT WITH Commons-Clause
import Foundation

/// Caret-offset mapping between the rendered (visible, delimiter-free) text and the
/// source markdown. Ported verbatim from `mapRenderedOffsetToSource` /
/// `mapSourceOffsetToRendered` in `contentRenderer.ts`. Offsets are UTF-16 code units.
public enum OffsetMapping {
    /// Rendered offset → source offset. A zero-width rendered token (header prefix) is
    /// skipped so rendered offset 0 maps onto the first real character, not before the
    /// hashes.
    public static func renderedToSource(_ tokens: [ContentToken], _ renderedOffset: Int) -> Int {
        var renderedPos = 0
        var lastSourceEnd = 0
        for token in tokens {
            let s = token.span
            lastSourceEnd = s.srcFrom + s.srcLen
            if renderedOffset <= renderedPos + s.renderedLen {
                if s.renderedLen == 0 { continue }
                return s.srcFrom + s.lead + (renderedOffset - renderedPos)
            }
            renderedPos += s.renderedLen
        }
        return lastSourceEnd
    }

    /// Source offset → rendered offset. Source inside a leading/trailing delimiter clamps
    /// to the token's rendered start/end; inside the visible span it maps one-to-one.
    public static func sourceToRendered(_ tokens: [ContentToken], _ sourceOffset: Int) -> Int {
        var renderedPos = 0
        var lastRenderedEnd = 0
        for token in tokens {
            let s = token.span
            lastRenderedEnd = renderedPos + s.renderedLen
            if sourceOffset <= s.srcFrom + s.srcLen {
                let within = max(0, min(sourceOffset - s.srcFrom - s.lead, s.renderedLen))
                return renderedPos + within
            }
            renderedPos += s.renderedLen
        }
        return lastRenderedEnd
    }
}
