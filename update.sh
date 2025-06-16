#!/bin/bash

# Lưu lại file .env hiện tại
cp .env .env.backup

# Pull code mới nhất từ GitHub
git pull origin main

# Khôi phục file .env
cp .env.backup .env

# Cài đặt dependencies nếu cần
npm install

# Khởi động lại bot
pm2 restart all 