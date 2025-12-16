import tkinter as tk


def calculate_hydraulic_resistance():
    try:
        # 从输入框中获取用户输入的值
        air_speed_duct = float(air_speed_duct_entry.get())
        air_speed_device = float(air_speed_device_entry.get())
        air_speed_outlet = float(air_speed_outlet_entry.get())

        duct_length = float(duct_length_entry.get())
        bend_count = int(bend_count_entry.get())
        tee_count = int(tee_count_entry.get())
        valve_count = int(valve_count_entry.get())
        sudden_change_count = int(sudden_change_count_entry.get())

        filter_resistance = float(filter_resistance_entry.get())
        cooler_resistance = float(cooler_resistance_entry.get())
        heater_resistance = float(heater_resistance_entry.get())
        adsorber_resistance = float(adsorber_resistance_entry.get())
        outlet_resistance = float(outlet_resistance_entry.get())
        other_resistance = float(other_resistance_entry.get())

        # 执行水力计算的逻辑，这里只是一个示例
        # 计算总阻力
        total_resistance = (
            filter_resistance + cooler_resistance + heater_resistance +
            adsorber_resistance + outlet_resistance + other_resistance +
            (duct_length * bend_count * 0.5) + (duct_length * tee_count * 0.25) +
            (duct_length * valve_count * 0.1) +
            (duct_length * sudden_change_count * 0.2)
        )

        # 在结果文本框中显示总阻力
        result_text.config(state=tk.NORMAL)
        result_text.delete(1.0, tk.END)
        result_text.insert(tk.END, f"总阻力: {total_resistance} Pa")
        result_text.config(state=tk.DISABLED)
    except ValueError:
        result_text.config(state=tk.NORMAL)
        result_text.delete(1.0, tk.END)
        result_text.insert(tk.END, "请输入有效的数字")
        result_text.config(state=tk.DISABLED)


# 创建主窗口
root = tk.Tk()
root.title("通风系统水力计算程序")

# 第一行输入
air_speed_duct_label = tk.Label(root, text="风管风速 (m/s):")
air_speed_duct_label.grid(row=0, column=0)
air_speed_duct_entry = tk.Entry(root)
air_speed_duct_entry.grid(row=0, column=1)
air_speed_duct_entry.insert(0, "5.0")  # 设置默认值

air_speed_device_label = tk.Label(root, text="设备风速 (m/s):")
air_speed_device_label.grid(row=0, column=2)
air_speed_device_entry = tk.Entry(root)
air_speed_device_entry.grid(row=0, column=3)
air_speed_device_entry.insert(0, "2.0")  # 设置默认值

air_speed_outlet_label = tk.Label(root, text="风口风速 (m/s):")
air_speed_outlet_label.grid(row=0, column=4)
air_speed_outlet_entry = tk.Entry(root)
air_speed_outlet_entry.grid(row=0, column=5)
air_speed_outlet_entry.insert(0, "1.0")  # 设置默认值

# 第二行输入
duct_length_label = tk.Label(root, text="直管长度 (m):")
duct_length_label.grid(row=1, column=0)
duct_length_entry = tk.Entry(root)
duct_length_entry.grid(row=1, column=1)
duct_length_entry.insert(0, "10.0")  # 设置默认值

bend_count_label = tk.Label(root, text="弯头数量:")
bend_count_label.grid(row=1, column=2)
bend_count_entry = tk.Entry(root)
bend_count_entry.grid(row=1, column=3)
bend_count_entry.insert(0, "3")  # 设置默认值

tee_count_label = tk.Label(root, text="三通数量:")
tee_count_label.grid(row=1, column=4)
tee_count_entry = tk.Entry(root)
tee_count_entry.grid(row=1, column=5)
tee_count_entry.insert(0, "2")  # 设置默认值

valve_count_label = tk.Label(root, text="风阀数量:")
valve_count_label.grid(row=1, column=6)
valve_count_entry = tk.Entry(root)
valve_count_entry.grid(row=1, column=7)
valve_count_entry.insert(0, "1")  # 设置默认值

sudden_change_count_label = tk.Label(root, text="突变径数量:")
sudden_change_count_label.grid(row=1, column=8)
sudden_change_count_entry = tk.Entry(root)
sudden_change_count_entry.grid(row=1, column=9)
sudden_change_count_entry.insert(0, "0")  # 设置默认值

# 第三行输入
filter_resistance_label = tk.Label(root, text="过滤器阻力:")
filter_resistance_label.grid(row=2, column=0)
filter_resistance_entry = tk.Entry(root)
filter_resistance_entry.grid(row=2, column=1)
filter_resistance_entry.insert(0, "50.0")  # 设置默认值

cooler_resistance_label = tk.Label(root, text="冷却器阻力:")
cooler_resistance_label.grid(row=2, column=2)
cooler_resistance_entry = tk.Entry(root)
cooler_resistance_entry.grid(row=2, column=3)
cooler_resistance_entry.insert(0, "20.0")  # 设置默认值

heater_resistance_label = tk.Label(root, text="加热器阻力:")
heater_resistance_label.grid(row=2, column=4)
heater_resistance_entry = tk.Entry(root)
heater_resistance_entry.grid(row=2, column=5)
heater_resistance_entry.insert(0, "30.0")  # 设置默认值

adsorber_resistance_label = tk.Label(root, text="碘吸附器阻力:")
adsorber_resistance_label.grid(row=2, column=6)
adsorber_resistance_entry = tk.Entry(root)
adsorber_resistance_entry.grid(row=2, column=7)
adsorber_resistance_entry.insert(0, "10.0")  # 设置默认值

outlet_resistance_label = tk.Label(root, text="末端风口阻力:")
outlet_resistance_label.grid(row=2, column=8)
outlet_resistance_entry = tk.Entry(root)
outlet_resistance_entry.grid(row=2, column=9)
outlet_resistance_entry.insert(0, "5.0")  # 设置默认值

other_resistance_label = tk.Label(root, text="其他阻力:")
other_resistance_label.grid(row=2, column=10)
other_resistance_entry = tk.Entry(root)
other_resistance_entry.grid(row=2, column=11)
other_resistance_entry.insert(0, "15.0")  # 设置默认值

# 第四行按钮
calculate_button = tk.Button(
    root, text="计算通风水力", command=calculate_hydraulic_resistance)
calculate_button.grid(row=3, column=0, columnspan=12)

# 第五行结果文本框
result_text = tk.Text(root, height=5, width=40, state=tk.DISABLED)
result_text.grid(row=4, column=0, columnspan=12, pady=(10, 0))

# 启动主循环
root.mainloop()
