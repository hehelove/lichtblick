# Build stage
FROM node:22 AS build
WORKDIR /src
COPY . ./

RUN corepack enable
# web 构建不需要 electron 桌面二进制；跳过其下载，避免 postinstall 去 GitHub 拉包失败。
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# yarn 缓存挂载：源码改动会让 COPY 层失效进而重跑 install，但 BuildKit cache mount 按目标路径持久化，
# 已下载的包不会再走外网重拉，迭代时 install 近乎秒过。
RUN --mount=type=cache,target=/src/.yarn/cache yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080

COPY <<EOF /entrypoint.sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /lichtblick
touch /lichtblick/default-layout.json
index_html=\$(cat index.html)
replace_pattern='/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=\$(cat /lichtblick/default-layout.json)
echo "\${index_html/"\$replace_pattern"/\$replace_value}" > index.html

# Continue executing the CMD
exec "\$@"
EOF

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8080"]
