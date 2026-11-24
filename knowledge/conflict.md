# Conflicts

Các mâu thuẫn / thắc mắc chưa được người dùng xác nhận khi chạy `/ingest`.
Mỗi mục xử lý xong thì xoá khỏi file này (hoặc chuyển xuống "Resolved").

## Open

<!-- Mẫu:
### [YYYY-MM-DD] <topic path> — <tiêu đề ngắn>
- **Nguồn mới:** source/<file> (vị trí/đoạn)
- **Knowledge hiện có:** knowledge/<topic>/_notes/<id>.md (node "<title>")
- **Mâu thuẫn / thắc mắc:** ...
- **Đề xuất:** ...
-->

### [2026-11-22] Stream/Kafka (Producers) — batch.size / linger.ms ảnh hưởng latency thế nào?
- **Nguồn mới:** source/6.2.Producer performance.txt (Table 6.1 và mục 6.2.2)
- **Knowledge hiện có:** Producers > Batching, ppt: batch.size, ppt: linger.ms (chưa ghi nhận định về latency)
- **Mâu thuẫn / thắc mắc:** Table 6.1 ghi batch.size/linger.ms lớn hơn => latency cao hơn, nhưng ví dụ test lại cho thấy tăng batch.size=100000 + linger.ms=100 làm latency giảm 165 ms -> 65 ms (do batch mặc định 16 KB nhỏ hơn message 10 KB nên không batching được, message bị dồn lại). Cần quyết định ghi nhận định nào/điều kiện nào.
- **Đề xuất:** Ghi cả hai: quy tắc chung (tăng thì latency tăng) và ngoại lệ khi batch.size mặc định nhỏ hơn kích thước message.

## Resolved
