Kafka tăng throughput bằng **batching**: gom nhiều message vào 1 batch trước khi gửi lên broker. Batch lớn => ít network request, hiệu quả hơn. Cấu hình độc lập trên mỗi producer bằng **batch.size** và **linger.ms**.
+ Producer giữ 1 batch riêng cho mỗi **topic + partition**
+ Batch được gửi ngay khi **đầy (batch.size)** hoặc **hết thời gian chờ (linger.ms)**
+ Dù linger.ms = 0, batching vẫn xảy ra tự nhiên khi message sinh ra nhanh hơn tốc độ gửi

![image](image:2lr7y1rh_1.png)
