# 开源项目二次开发与服务器部署完整流程

> 本文是通用参考资料。RichiDrama 的实际部署要求以 [`../deployment/`](../deployment/) 和仓库 `deploy/` 目录为准。

## 1. 文档目标

本文描述如何将一个开源项目进行：

- Fork 管理
- 本地开发
- 二次修改
- 服务器部署
- 后续版本维护

目标：

> 建立一个可持续迭代的开源项目二次开发流程，而不是一次性部署。

---

# 2. 整体流程概览

```text
                开源项目官方仓库
                       |
                       |
                     Fork
                       |
                       ↓
              我的 GitHub/Gitee 仓库
                       |
                       |
                    Clone
                       |
                       ↓
                 本地开发环境

                       |
              git commit / push

                       |
                       ↓

                 服务器拉取代码

                       |
                       ↓

              Docker 部署运行

                       |
                       ↓

                  用户访问
```

---

# 3. 第一步：Fork 开源项目

## 3.1 为什么需要 Fork

不要直接修改官方仓库。

如果直接 clone：

```
官方仓库
    |
    |
    ↓
本地修改
```

问题：

- 无法管理自己的版本
- 无法提交自己的代码
- 后续同步困难


推荐：

```
官方仓库 upstream

        |
        |
        ↓

自己的仓库 origin

        |
        |
        ↓

本地开发
```

---

## 3.2 Fork 操作

进入 GitHub 开源项目页面：

点击：

```
Fork
```

生成：

```
github.com/你的账号/project
```

以后这个仓库属于你。

---

# 4. 第二步：Clone 到本地

克隆自己的仓库：

```bash
git clone https://github.com/你的账号/project.git
```

进入项目：

```bash
cd project
```

查看远程仓库：

```bash
git remote -v
```

结果：

```
origin
https://github.com/你的账号/project.git
```

说明：

当前代码关联自己的仓库。

---

# 5. 第三步：建立开发分支

不要直接修改 main 分支。

推荐：

```
main
 |
 |
develop
 |
 |
feature
```

创建开发分支：

```bash
git checkout -b develop
```

---

## 功能开发创建 feature 分支

例如：

开发视频接口：

```bash
git checkout -b feature/video-api
```

完成后：

```bash
git add .
git commit -m "新增视频生成接口"

git push origin feature/video-api
```

---

# 6. 第四步：本地运行项目

首先查看：

```
README.md
```

确认：

- 技术栈
- 环境要求
- 启动方式


例如：

## Java 项目

启动：

```bash
mvn spring-boot:run
```


## Vue 项目

安装依赖：

```bash
npm install
```


启动：

```bash
npm run dev
```


## Docker 项目

如果存在：

```
docker-compose.yml
```

直接：

```bash
docker compose up
```

---

# 7. 第五步：项目配置整理

开源项目常见问题：

配置写死：

```yaml
mysql:
 username=root
 password=123456
```

不推荐。

---

## 推荐方式

使用环境变量：

application.yml：

```yaml
mysql:
 username:${MYSQL_USER}
 password:${MYSQL_PASSWORD}
```

服务器：

创建：

```
.env
```

内容：

```env
MYSQL_USER=root
MYSQL_PASSWORD=123456

REDIS_HOST=redis

API_KEY=xxxx
```

优势：

- 代码公开
- 密钥隔离
- 不同环境使用不同配置

---

# 8. 第六步：服务器环境准备

服务器安装：

## 必备软件

```
Git
Docker
Docker Compose
Nginx
```

---

Ubuntu 示例：

```bash
apt update

apt install git

apt install docker.io
```

检查：

```bash
docker -v

git -v
```

---

# 9. 第七步：服务器拉取代码

进入部署目录：

```bash
cd /data/apps
```

拉取代码：

```bash
git clone https://github.com/你的账号/project.git
```

目录：

```
/data/apps/project
```

推荐：

```
/data/apps/

├── project
│
├── volumes
│
└── logs
```

---

# 10. 第八步：Docker 部署

## 推荐目录结构

```
project

├── backend
│
├── frontend
│
├── docker-compose.yml
│
├── Dockerfile
│
├── .env
│
└── volumes
    |
    ├── mysql
    ├── redis
    └── minio
```

---

# 11. Docker Compose 管理服务


示例：

```yaml
services:

  mysql:
    image: mysql:8
    volumes:
      - ./volumes/mysql:/var/lib/mysql


  redis:
    image: redis


  backend:
    build:
      context: ./backend


  frontend:
    build:
      context: ./frontend
```

启动：

```bash
docker compose up -d
```

查看：

```bash
docker compose ps
```

日志：

```bash
docker compose logs -f backend
```

---

# 12. 数据持久化

不要：

```
数据库运行在容器内部
```

因为：

删除容器：

```
数据丢失
```

---

正确：

```
宿主机

/data/apps/project/volumes/mysql

          |
          |
          ↓

Docker MySQL
```

配置：

```yaml
volumes:

 - ./volumes/mysql:/var/lib/mysql
```

---

# 13. 日常开发维护流程


## 本地开发

修改代码：

```
代码修改
```

提交：

```bash
git add .

git commit -m "完成xxx功能"

git push
```


---

## 服务器更新


进入服务器：

```bash
ssh user@server
```


进入项目：

```bash
cd /data/apps/project
```


拉取最新代码：

```bash
git pull
```


重新构建：

```bash
docker compose build
```


重新启动：

```bash
docker compose up -d
```

---

# 14. 后续版本同步官方仓库

添加官方仓库：

```bash
git remote add upstream 官方地址
```

查看：

```bash
git remote -v
```

同步：

```bash
git fetch upstream
```


合并：

```bash
git merge upstream/main
```

---

# 15. 推荐最终架构

```
                Git仓库

                   |
                   ↓

              服务器

                   |
          Docker Compose

                   |
 --------------------------------

 前端          后端          中间件

 Vue          SpringBoot     MySQL
 Nginx        FastAPI        Redis
                             MinIO


                   |
                   ↓

             数据持久化目录
```

---

# 16. 最小可维护方案

如果只是个人二次开发：

必须具备：

```
Git
+
Docker Compose
+
.env配置
+
数据持久化
+
README部署文档
```

即可。


不要一开始引入：

- Kubernetes
- 微服务拆分
- CI/CD平台

先保证：

```
能运行
+
能修改
+
能更新
+
能回滚
```

---

# 17. 推荐实施顺序

按照以下顺序执行：

```
① Fork项目

② Clone到本地

③ 本地运行成功

④ 理解项目结构

⑤ 创建开发分支

⑥ 修改代码

⑦ 提交自己的仓库

⑧ 服务器安装环境

⑨ Git拉取代码

⑩ Docker部署

⑪ 后续持续迭代
```

---

# 总结

开源项目二次开发的核心思想：

> 不只是把项目部署起来，而是建立一个可持续维护的软件生命周期。

最终形成：

```
源码管理
    +
环境隔离
    +
自动部署
    +
数据持久化
    +
版本控制
```

这样后续无论增加功能、更换模型、修改业务，都不会推倒重来。
