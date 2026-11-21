# Hosting

The lab is served by the same Caddy as the main site, at `https://donotpissmeoff.com/dilemma/`,
from its own web root `/var/www/dilemma`. Keeping it out of `/var/www/dpmo` matters: the main
site's `deploy.sh` deletes anything in its web root that it did not put there.

The route is in the main site's Caddyfile (`donotpissmeoff/deploy/Caddyfile`, inside `(site)`):

```caddy
# Stool Pigeon, the prisoner's dilemma lab: own repository, own web root.
redir /dilemma /dilemma/ permanent
handle_path /dilemma/* {
	root * /var/www/dilemma
	# Files are not fingerprinted: always revalidate (ETag), never serve stale code.
	header Cache-Control "no-cache"
	file_server {
		hide .*
	}
}
```

and the 404 handler sets `root * /var/www/dpmo` before serving `404.html`, so missing files under
`/dilemma/` still get the site's 404 page.

The security headers of the main site apply unchanged, including
`Content-Security-Policy: default-src 'self'`. That is why the app never uses `eval`, inline
scripts or inline styles, and why strategies are written in a small language of their own.

First install (once): `ssh <host> 'sudo install -d -o "$USER" /var/www/dilemma'`.
After that, `./deploy.sh` is all it takes.
