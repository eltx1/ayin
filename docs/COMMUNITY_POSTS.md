# AYIN Community Posts

Community is channel-scoped, not a general-purpose social network. Creators can draft, schedule, edit, publish and remove text, image, poll and video-share posts. Published posts appear on the channel Community surface and in the authenticated feed of subscribed viewer profiles.

Creator Studio exposes all four post types, scheduling, editing, direct image upload, immediate publishing and removal. Image dimensions are captured by the browser for stable responsive rendering. An image post remains a draft—and is excluded defensively from public queries—until the separately uploaded R2 object is validated; scheduled visibility cannot bypass that gate.

Image posts use the same configured R2/media adapter through a bounded JPG/PNG/WebP upload authorization and server-side object verification. Video-share posts reference existing AYIN videos and never copy media. Poll votes, likes and threaded community comments are profile-scoped. Reports feed an Admin moderation queue; hide/remove/restore actions are audited. Publishing sends channel notifications to subscriber accounts once.

Scheduled posts are resolved as visible when their scheduled time is reached even without a background scheduler. The global `communityPostsEnabled` control can disable publishing/discovery. Existing video media rules remain unchanged.
