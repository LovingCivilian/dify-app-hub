# 邮箱找回密码

登录页提供「忘记密码」功能。配置 SMTP 后，用户可以通过邮箱收到一次性密码重置链接。

## 使用条件

需要在部署环境中配置 SMTP，并设置应用的访问地址。未配置 SMTP 时，找回密码页面会提示联系管理员。

```env
SMTP_ENABLED=true
SMTP_SERVER=smtp.example.com
SMTP_PORT=465
SMTP_USERNAME=noreply@example.com
SMTP_PASSWORD=邮箱授权码
SMTP_USE_TLS=true
MAIL_DEFAULT_SEND_FROM="Dify App Hub <noreply@example.com>"
APP_URL=https://dify.example.com
```

`SMTP_PASSWORD` 应使用邮箱服务商提供的授权码或应用专用密码，不要使用邮箱网页登录密码。

使用 `465` 端口时采用隐式 TLS；如果使用 `587` 端口，需要使用支持 STARTTLS 的 SMTP 服务。

## 找回流程

1. 在登录页点击「忘记密码」。
2. 输入账户邮箱并提交。
3. 打开邮件中的重置链接。
4. 设置并确认新密码。
5. 使用新密码重新登录。

重置链接 15 分钟后过期，只能使用一次。密码重置成功后，该账户之前的登录会话会失效。

出于安全考虑，页面不会直接提示邮箱是否已注册。未收到邮件时，请检查邮箱地址、垃圾邮件文件夹和 SMTP 配置。
