#!/bin/bash

# PMS 弹窗轮询优化测试脚本
# 对比原版和优化版的性能差异

echo "=== PMS 弹窗轮询性能测试 ==="

# 设置测试环境变量
export PMS_E2E_PASSWORD='Admin@1234'
export PMS_EMBEDDED_SITE_SUBSTRING='127.0.0.1'
export CHROME_CDP_URL='http://127.0.0.1:9222'

echo "1. 测试原版轮询（预计 45 秒）"
time npm run test:pms:cdp:attach:full 2>&1 | grep -E "\[cdp\]|轮询|弹窗|完成"

echo ""
echo "2. 测试优化版轮询（预计 15 秒）"
# 这里需要创建一个使用优化版本的 npm script
# 暂时手动运行优化版本
echo "优化版本需要单独实现 npm script"

echo ""
echo "=== 性能对比分析 ==="
echo "原版问题："
echo "- 轮询时长: 45秒"
echo "- 每次等待: 12秒超时"
echo "- 轮询间隔: 0.9秒"
echo "- 总耗时: 最多 45 秒"

echo ""
echo "优化版本："
echo "- 轮询时长: 15秒"
echo "- 快速检测: 1秒超时"
echo "- 轮询间隔: 2秒"
echo "- 预计耗时: 最多 15 秒"

echo ""
echo "=== 根本原因总结 ==="
echo "1. 轮询策略过于保守：45秒的轮询时长对于正常弹窗来说太长"
echo "2. 每次轮询都有12秒的waitFor超时，导致大量时间浪费"
echo "3. 选择器过于宽泛，搜索效率低"
echo "4. 缺乏智能检测：没有先快速检查弹窗是否存在"

echo ""
echo "=== 建议的优化方案 ==="
echo "1. 将轮询时长减少到15-20秒"
echo "2. 使用快速预检（1秒超时）+ 精确等待（3秒超时）的两阶段策略"
echo "3. 优化选择器，优先使用最常见的弹窗类型"
echo "4. 增加调试日志，便于排查问题"
echo "5. 一旦找到并处理弹窗就立即退出轮询"
