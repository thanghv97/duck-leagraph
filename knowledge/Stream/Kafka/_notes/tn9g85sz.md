+ acks = 0 -> Producer sẽ nhận được repsonse lập tức mà không cần confirm gì cả
+ acks = 1 -> Producer sẽ nhận được repsonse sau khi dữ liệu được ghi nhận vào node leader (OS Page)
+ acks = all (acks = -1) -> Producer sẽ nhận được repsonse sau khi toàn bộ min.insync.replica được replicated data (OS Page)

![image](image:tn9g85sz_1.png)
