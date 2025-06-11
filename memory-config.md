# Cấu Hình Tối Ưu Hóa RAM

## 1. Biến Môi Trường (.env)

Thêm các biến sau vào file `.env`:

```env
# Môi trường
NODE_ENV=production

# Ngưỡng RAM
MEMORY_THRESHOLD=80
MEMORY_WARNING_THRESHOLD=70
CACHE_CLEANUP_INTERVAL=1800000  # 30 phút
CACHE_TTL=300000  # 5 phút

# Cấu hình Node.js
NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
```

## 2. Giải Thích Các Ngưỡng

### Ngưỡng RAM (MEMORY_THRESHOLD)
- **Giá trị mặc định**: 80%
- **Ý nghĩa**: Khi RAM sử dụng vượt quá ngưỡng này, hệ thống sẽ:
  - Kích hoạt garbage collection
  - Xóa cache
  - Ghi log cảnh báo
- **Khuyến nghị**: 
  - Server 1GB RAM: 70-75%
  - Server 2GB RAM: 75-80%
  - Server 4GB+ RAM: 80-85%

### Ngưỡng Cảnh Báo (MEMORY_WARNING_THRESHOLD)
- **Giá trị mặc định**: 70%
- **Ý nghĩa**: Khi RAM sử dụng vượt quá ngưỡng này, hệ thống sẽ:
  - Ghi log cảnh báo
  - Chuẩn bị tối ưu hóa
- **Khuyến nghị**: Thấp hơn MEMORY_THRESHOLD 5-10%

### Thời Gian Cache (CACHE_TTL)
- **Giá trị mặc định**: 300000ms (5 phút)
- **Ý nghĩa**: Thời gian cache được lưu trữ trước khi tự động xóa
- **Khuyến nghị**:
  - Dữ liệu thay đổi thường xuyên: 1-2 phút
  - Dữ liệu ít thay đổi: 5-10 phút
  - Dữ liệu tĩnh: 15-30 phút

### Chu Kỳ Dọn Cache (CACHE_CLEANUP_INTERVAL)
- **Giá trị mặc định**: 1800000ms (30 phút)
- **Ý nghĩa**: Tần suất kiểm tra và dọn cache
- **Khuyến nghị**:
  - Server ít RAM: 15 phút
  - Server nhiều RAM: 30-60 phút

## 3. Cấu Hình Node.js

### NODE_OPTIONS
- **--max-old-space-size**: Giới hạn heap size
  - Server 1GB RAM: 512MB
  - Server 2GB RAM: 1024MB
  - Server 4GB RAM: 2048MB

### NODE_ENV
- **production**: Kích hoạt tối ưu hóa và garbage collection
- **development**: Tắt một số tối ưu hóa để dễ debug

## 4. Theo Dõi và Điều Chỉnh

1. **Kiểm tra logs**:
   - Theo dõi các cảnh báo về RAM
   - Xem tần suất garbage collection
   - Kiểm tra hiệu suất cache

2. **Điều chỉnh ngưỡng**:
   - Nếu thấy cảnh báo quá nhiều: tăng ngưỡng
   - Nếu RAM vẫn cao: giảm ngưỡng
   - Nếu cache không hiệu quả: điều chỉnh TTL

3. **Tối ưu hóa thêm**:
   - Giảm số lượng tác vụ đồng thời
   - Tăng thời gian giữa các lần kiểm tra
   - Giảm kích thước cache

## 5. Lưu ý Quan Trọng

1. Luôn backup dữ liệu trước khi thay đổi cấu hình
2. Thay đổi từng tham số một và theo dõi hiệu ứng
3. Không đặt ngưỡng quá thấp để tránh tối ưu hóa không cần thiết
4. Đảm bảo có đủ RAM cho các tác vụ khác của hệ thống 