# Server-controlled video playlist

הפלייליסט של גלריית סרטוני ההדרכה נקבע בצד שרת בלבד.

API חדש:
GET /api/video-gallery/playlist
POST /api/admin/video-gallery/playlist

הנתיב הניהולי מותר רק למנהל עם is_admin.

ההגדרה נשמרת בטבלת app_settings:
- VIDEO_GALLERY_PLAYLIST_ID
- VIDEO_GALLERY_PLAYLIST_NAME

קבצים ששונו:
- worker/video_gallery.js
- worker/index.js
- worker/security.js
- src/premium/header_icons.js

אבטחה:
משתמש רגיל רק קורא מהשרת.
שינוי הפלייליסט נעשה רק דרך API ניהולי עם בדיקת is_admin בצד שרת.
