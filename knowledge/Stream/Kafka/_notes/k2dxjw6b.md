Khi enable.idempotence = true, procedure sẽ yêu cầu các thuộc tính khác phải setting đúng  theo yêu cầu để đảm bảo tính idempotence
+ acks = all
+ max.in.flight.requests.per.connection <= 5 
+ retries > 0