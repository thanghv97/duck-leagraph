---
description: Phân tích tài liệu trong inbox/ và đưa knowledge vào knowledge/, xong thì chuyển tài liệu sang source/
argument-hint: "[file hoặc topic path, tuỳ chọn]"
---

Bạn đang thực thi `/ingest` cho dự án Duck LeaGraph. Đối số (nếu có): `$ARGUMENTS` — giới hạn xử lý vào file/topic đó; để trống thì xử lý toàn bộ `inbox/`.

## Cấu trúc dự án
- `inbox/` — tài liệu thô người dùng thả vào (md, txt, pdf, docx, ảnh...). Bỏ qua `.gitkeep`.
- `knowledge/<Nhóm>/<Topic>/` — mỗi topic gồm:
  - `map.json` — map chính: `{version:2, nodes[], links[], center}`; node có `id,title,x,y,color`, tuỳ chọn `note:true` (có note), `sub:true` (có map con ở `_maps/<id>.json`), `desc`, `tags`, `bookmark`. Link: `{id,a,b,dir?}`.
  - `_maps/<nodeId>.json` — map con (cùng định dạng, có `center`).
  - `_notes/<nodeId>.md` — nội dung note của node; ảnh ở `_notes/_img/`, đặt tên `<nodeId>_<index>.<ext>` (index bắt đầu từ 1) và tham chiếu trong note bằng `![image](image:<tên file>)`.
- `knowledge/conflict.md` — các conflict/thắc mắc chưa xử lý.
- `source/` — nơi lưu tài liệu gốc sau khi đã ingest.

## Quy trình
1. **Liệt kê** file trong `inbox/` (trừ `.gitkeep`). Nếu rỗng, báo lại và dừng.
2. **Đọc & phân tích** từng tài liệu (PDF dùng Read với `pages`; ảnh dùng Read). Rút ra khái niệm chính, quan hệ giữa các khái niệm, định nghĩa, ví dụ.
3. **Định vị topic**: đọc cấu trúc `knowledge/` hiện có (và `map.json`, note liên quan) để chọn topic đích. Nếu chưa có topic phù hợp hoặc không chắc, hỏi người dùng (AskUserQuestion) trước khi tạo topic mới.
4. **Bóc tách theo loại nội dung được phép thêm**. Với mỗi ý rút ra, xếp vào một trong các loại sau (danh sách này có thể được người dùng mở rộng thêm, xem bước 5):
   - **Description của box**: ghi vào trường `desc` của node hiện có (tóm tắt ngắn, 1–2 câu). Nếu node đã có `desc` khác nghĩa thì xem là conflict.
   - **Note của box**: thêm/bổ sung vào `_notes/<nodeId>.md` của node hiện có (bật `note:true` nếu chưa có). Bổ sung vào cuối note, không viết lại phần cũ.
   - **Box mới link từ box cũ**: tạo node mới và `link` từ node hiện có (node cha) tới node mới.
   Đối chiếu với knowledge hiện có:
   - *Mới*: thêm theo loại phù hợp ở trên.
   - *Trùng*: bỏ qua hoặc bổ sung chi tiết, không nhân đôi node.
   - *Conflict / mơ hồ* (mâu thuẫn với note hiện có, hai tài liệu nói khác nhau, thiếu ngữ cảnh): **không tự quyết**.
   - *Ngoài các loại trên* (ví dụ: sửa/xoá/đổi tên box cũ, tạo topic/map mới, đổi màu/vị trí, tag, bookmark, thông tin không biết đặt vào đâu): **không tự ignore và không tự ghi**, đưa sang bước 5 để hỏi.
5. **Confirm với người dùng** (AskUserQuestion) cho mọi conflict/thắc mắc và mọi nội dung ngoài các loại ở bước 4: nêu rõ nội dung cũ vs mới (hoặc nội dung đó là gì), đề xuất phương án. Với nội dung ngoài danh sách, cho các lựa chọn: *Ignore*, *Thêm vào loại có sẵn* (chỉ rõ loại), *Thêm loại mới vào danh sách cho phép* (người dùng mô tả loại đó, áp dụng cho phần còn lại của lần ingest này và ghi thêm vào mục "Loại nội dung được phép" trong `ingest.md` nếu người dùng muốn dùng lâu dài). Chỉ ignore khi người dùng chọn Ignore. Gom nhiều câu hỏi vào một lượt. Nếu người dùng chưa muốn trả lời/bỏ qua → ghi vào `knowledge/conflict.md` mục **Open** theo mẫu trong file, KHÔNG sửa knowledge ở phần đó.
6. **Ghi knowledge** (chỉ phần đã rõ và thuộc loại được phép):
   - Giữ nguyên ngôn ngữ và văn phong của note hiện có trong topic (hiện là tiếng Việt, markdown, in đậm thuật ngữ).
   - Node mới: `id` ngẫu nhiên 8 ký tự `[a-z0-9]`, đặt `x,y` gần node cha và không đè node khác, dùng `color` cùng cấp với các node anh em, thêm `links` tới node cha. Note mới → `note:true` và file `_notes/<id>.md`.
   - Chỉ sửa tối thiểu `map.json`/`_maps`; giữ định dạng JSON 2 space indent, UTF-8, không đổi node/id đang có nếu không cần.
   - Xác nhận JSON vẫn hợp lệ sau khi ghi (`python -X utf8 -c "import json;json.load(open(path,encoding='utf-8'))"`).
7. **Chuyển tài liệu**: tài liệu đã xử lý xong → `git mv`/move từ `inbox/` sang `source/` (giữ tên; nếu trùng tên thì thêm hậu tố ngày `-YYYYMMDD`). Tài liệu còn conflict chưa giải quyết xong hoàn toàn vẫn được chuyển sang `source/` nhưng phải được tham chiếu trong `knowledge/conflict.md`. Tài liệu bạn không đọc được/không chắc → giữ lại trong `inbox/` và báo người dùng.
8. **Báo cáo** ngắn gọn: tài liệu đã xử lý, node/note đã thêm hoặc sửa theo topic, conflict đã giải quyết, mục còn mở trong `conflict.md`, file còn lại trong `inbox/`.

## Loại nội dung được phép (người dùng có thể mở rộng)
- Description của box (`desc`)
- Note của box (`_notes/<id>.md`)
- Box mới link từ box cũ

## Nguyên tắc
- Không xoá hay ghi đè knowledge hiện có khi chưa được người dùng đồng ý.
- Không commit/push trừ khi người dùng yêu cầu.
- Không bịa thông tin ngoài tài liệu; thông tin suy luận phải đánh dấu rõ hoặc hỏi lại.
