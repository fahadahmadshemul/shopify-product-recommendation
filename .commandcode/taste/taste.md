# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- When reviewing a system, explore all related files thoroughly first, then proactively implement the improvements rather than just providing analysis. Confidence: 0.70
- Document all features comprehensively in .commandcode/session-context.md as a complete project reference that can be rewritten from scratch for clarity when needed. Confidence: 0.85

# prisma
- On Windows, when Prisma generate fails with EPERM rename error on query_engine-windows.dll.node, rename the locked file first (using `ren`) instead of trying to delete it, then re-run prisma generate. Confidence: 0.65

