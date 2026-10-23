# Rita ID Mobile

Ứng dụng Expo/React Native cho Android và iOS, đăng nhập SSO qua Rita ID Portal bằng Authorization Code + PKCE S256. Backend xác minh access token khi app gọi userinfo. App không nhập mật khẩu Odoo, không nhúng client secret, không xác thực bằng ID token hoặc decode JWT.

## Thiết lập

Dùng Node.js 24 và npm với `package-lock.json`. Không nâng cấp Expo/React Native để xử lý cấu hình OAuth.

```powershell
npm ci
Copy-Item .env.example .env
```

Chỉ copy nếu chưa có `.env`; không ghi đè môi trường hoặc commit thông tin tài khoản. Điền các biến sau, rồi khởi động lại Metro:

| Biến | Giá trị |
| --- | --- |
| `EXPO_PUBLIC_RITA_API_URL` | Origin backend, ví dụ `http://<HOST>:4000` |
| `EXPO_PUBLIC_RITA_PORTAL_URL` | Origin portal, ví dụ `http://<HOST>:3002` |
| `EXPO_PUBLIC_OAUTH_CLIENT_ID` | Client ID đăng ký trên portal; bắt buộc |
| `EXPO_PUBLIC_OAUTH_REDIRECT_URI` | `ritaidapp://redirect`; khớp scheme native hiện tại |

Thay `<HOST>` bằng host thực. Android emulator thường dùng `10.0.2.2` để truy cập máy host; thiết bị thật dùng IP LAN/domain truy cập được. `localhost` trên điện thoại là chính điện thoại. Backend/portal phải lắng nghe trên địa chỉ phù hợp và portal cần cấu hình API truy cập được từ trình duyệt trên thiết bị. HTTP phục vụ phát triển; môi trường triển khai cần HTTPS. Android debug hiện cho phép cleartext; không mở rộng chính sách release trong thay đổi này.

Không thêm `/api`, path, credentials, query hoặc fragment vào origin. Không có fallback về IP hoặc client ID cũ. Các biến `EXPO_PUBLIC_OAUTH_AUTH_URL`, `EXPO_PUBLIC_OAUTH_TOKEN_URL`, `EXPO_PUBLIC_OAUTH_USER_INFO_URL` không còn được đọc; thay bằng hai origin mới. Mọi biến `EXPO_PUBLIC_*` đều có thể nằm trong bundle, tuyệt đối không chứa client secret. File `.env` hiện có không được tự động sửa.

Đăng nhập portal bằng tài khoản được phép quản lý developer clients và tạo client:

- Redirect URI chính xác: `ritaidapp://redirect`.
- Scopes: `openid`, `profile`, `email`.
- Luồng: `authorization_code` với PKCE S256. Không gửi client secret từ native. Backend hiện cho đổi code có PKCE mà không yêu cầu secret; điều này không chứng minh hỗ trợ đầy đủ public-client/OIDC.

## Chạy native và web

```powershell
npm run android
# macOS với Xcode và thiết lập signing phù hợp:
npm run ios
```

OAuth cần bản build native có URL scheme `ritaidapp`, không dùng Expo Go để nghiệm thu callback. Xem [hướng dẫn OAuth của Expo](https://docs.expo.dev/guides/authentication/). Scheme đã khai báo trong `app.json` và Android manifest. Không đổi callback độc lập với native registration. iOS cần máy macOS; bundle iOS xuất được trên Windows không có nghĩa native build đã được kiểm chứng.

`npm start` chạy Metro. `npm run web` chỉ dành cho preview: web hiển thị thông báo đăng nhập chỉ hỗ trợ Android/iOS và không gọi SecureStore hoặc native browser. Không có callback/phiên đăng nhập web trong phạm vi này.

## Hợp đồng và vòng đời phiên

| Thao tác | Hợp đồng |
| --- | --- |
| Authorize | Trình duyệt tới portal `/oauth/authorize`, state + PKCE S256, scopes `openid profile email` |
| Exchange | POST `/auth/oauth/token`, JSON authorization code/client ID/redirect URI/verifier; response snake_case |
| Userinfo | GET `/auth/oauth/userinfo`, Bearer access token |
| Refresh | POST `/auth/refresh`, JSON `{ refreshToken }`; response `{ success, accessToken, refreshToken }` |
| Logout | POST `/auth/logout`, JSON `{ refreshToken }` |

API requests bỏ cookie và có timeout 10 giây. Không gọi OAuth refresh grant hoặc revoke endpoint. Token exchange/refresh không tự retry sau lỗi mạng hoặc timeout.

Userinfo gồm đúng các field app sử dụng: `_id` (local UUID), `name`, `email`, `employee_id`, `phone_number`, `is_developer`, `groups`. Employee code và số điện thoại có thể null; groups là `EMPLOYEE`, `CUSTOMER`, `ENTERPRISE`. `_id` không phải employee code hoặc numeric Odoo ID. App hiển thị danh tính thật, avatar chữ cái đầu, group/developer; không có barcode hoặc ảnh chân dung mẫu. Developer chỉ là dữ liệu hiển thị, không phải điều kiện đăng nhập.

Mỗi lần đăng nhập có một attempt trong bộ nhớ, hết hạn sau 10 phút. Callback phải đúng scheme/host/path, state đúng và không có query trùng lặp. Attempt chỉ dùng một lần; callback cũ hoặc callback sau khi tiến trình bị đóng không tạo phiên. App chỉ lưu token sau khi userinfo hợp lệ. Không ghi log code, callback URL, token hoặc profile.

SecureStore lưu một JSON record `rita_session_v1` gồm version, access token, refresh token và UUID tài khoản. Hai key legacy `oauth_access_token`, `oauth_refresh_token` được xóa và yêu cầu đăng nhập lại một lần. Không lưu mật khẩu/ID token/profile vào record. Nếu không xóa được SecureStore, app ẩn danh tính, chặn đăng nhập và yêu cầu thử đăng xuất lại; không báo đã xóa thành công khi thao tác thất bại.

App kiểm tra userinfo khi khởi động và khi trở lại foreground. Lỗi mạng/5xx giữ record nhưng ẩn danh tính và cho thử lại. Khi API trả 401, các request dùng chung một refresh đang chạy; request gốc chỉ retry một lần. Token mới được kiểm tra qua userinfo, phải giữ UUID rồi mới lưu cả cặp thay thế. Lỗi refresh, đổi danh tính, lỗi ghi SecureStore hoặc 401 sau retry kết thúc phiên. Response cũ không thể khôi phục phiên sau logout.

Không áp giới hạn phiên 5 phút của `oauth-example`, không lập lịch từ `expires_in: 300` cố định của backend. Backend quyết định hiệu lực token/session; app không có timer kiểm tra liên tục khi người dùng để màn hình mở. Request được bảo vệ mới phải đi qua `AuthSession.authorized()` để dùng cơ chế 401/refresh.

Logout chặn thao tác mới, chờ refresh đang chạy và gọi backend bằng refresh token mới nhất còn biết. Local state và SecureStore được xóa dù request logout thất bại; UI thông báo nếu không xác nhận được thu hồi server. Thao tác này không đăng xuất cookie SSO trong browser và không thu hồi ngay access JWT đã cấp.

## Giới hạn tương thích backend

- Token OAuth hiện không có `iss` hoặc `token_use`; access token từ `/auth/refresh` không có audience. App dựa vào userinfo được backend xác thực, không thêm kiểm tra claim trái với hợp đồng hiện tại và không tuyên bố OIDC conformance.
- Backend rotation chưa có transaction/concurrency lock. App giảm cạnh tranh trong một instance bằng một promise refresh; không sửa được cạnh tranh giữa thiết bị/process. Mất response có thể khiến app không biết token thay thế, nên phải đăng nhập lại.
- Session tạo từ OAuth không chứa Odoo token. Luồng này không cung cấp quyền truy cập HRM cần Odoo token; không có tính năng HRM mới.
- Khi kiểm tra nhiều tài khoản thật, đặt `MOCKUP_MODE=false` ở backend. Mockup mode có thể trả nhân viên cố định sau login Odoo.

## Kiểm tra

```powershell
npm run typecheck
npm test
$env:EXPO_NO_DOTENV='1'
$env:CI='1'
npx expo export --platform android --platform ios --output-dir dist-auth-check
```

Tests dùng Node test runner + tsx và dependency injection cho HTTP, storage, browser, random/clock. Không liên hệ PostgreSQL/Odoo hoặc sửa dữ liệu backend. `npm run lint` vẫn là Expo lint chưa có cấu hình ESLint đầy đủ; không dùng như gate đã xác nhận. Không chạy `reset-project` để cập nhật app: đó là script xóa/move starter project.

Smoke test trên thiết bị/bản build native: login → consent → đúng profile → restart → access token hết hạn → refresh → logout → tài khoản khác; thêm hủy browser, từ chối consent, mất mạng và foreground. Cần backend/portal/client/account phù hợp. Không coi unit tests hoặc export là bằng chứng smoke test đã đạt.

## Trạng thái kiểm chứng — 2026-10-14

Baseline trước triển khai: TypeScript lỗi ở hai chỗ `StyleSheet.absoluteFillObject`; chưa có test script. Hai chỗ này đã chuyển sang `StyleSheet.absoluteFill` của React Native đang cài. Các thay đổi chưa commit trong auth context và màn hình được giữ về bố cục/import, rồi cập nhật hành vi theo kế hoạch này.

Kiểm chứng trên commit nền `ea619e0` cộng working tree chưa commit (bao gồm thay đổi có sẵn và triển khai này):

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck` | Đạt cho app và test TypeScript |
| `npm test` | Đạt 27/27 tests |
| Expo export Android/iOS, `EXPO_NO_DOTENV=1`, `CI=1`, `--max-workers 2` | Đạt, 1625 module Android và 1535 module iOS; artifact ở `dist-auth-check/`, được Git ignore |
| `git diff --check` | Đạt; chỉ có cảnh báo Git chuyển LF/CRLF |
| Manifest/lockfile | dependencies và devDependencies khớp |

Sandbox ban đầu chặn npm network cache và Node test workers; cài test dependencies, chạy tests và export bằng quyền mở rộng đã thành công. Metro có cảnh báo `NO_COLOR`/`FORCE_COLOR`, không làm thất bại export. Không đọc `.env` trong export.

Chưa chạy native Android/iOS build hoặc smoke test với backend/portal/Odoo; không chạy migration. Thêm `tsx` và kiểu Node cho tests, không nâng cấp Expo/React Native. npm báo 29 dependency advisories khi cài (11 moderate, 18 high); không chạy `audit fix` hoặc nâng cấp ngoài phạm vi.
