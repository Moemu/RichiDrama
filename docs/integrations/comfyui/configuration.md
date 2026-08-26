# ComfyUI OpenAI 兼容代理安装

> 来源：社区整理资料。命令和目录需要按本机环境调整。

## 1. 获取代理代码

使用 PowerShell 执行：

```powershell
cd C:\ComfyUI
git clone https://github.com/pnyxai/comfyui-openai-api.git
cd C:\ComfyUI\comfyui-openai-api\apps\rust\comfyui-openai-api
```

## 2. 安装 Rust

打开 [Rust 安装页面](https://rust-lang.org/zh-CN/tools/install/)，安装 Rust 工具链。

## 3. 编译代理

```powershell
cargo clean
cargo build --release
```

## 4. 启动代理

```powershell
./target/release/comfyui-openai-api
```

终端显示 `Proxy server listening on 0.0.0.0:8080` 表示启动成功。

默认图像生成端点：

```text
http://127.0.0.1:8080/v1/images/generations
```

感谢社区成员“欧先生@全力以赴”整理原始教程。
