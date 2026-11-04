# cristinamagrina.ca / cristinamagrina.es

Dos sitios estáticos generados desde un mismo repositorio. Sin dependencias: solo Node 18+.

| Sitio | Dominio | Contenido | Salida |
|---|---|---|---|
| `ca` | cristinamagrina.ca | Terapia online en Canadá (EN en `/`, ES en `/es/`) | `dist/ca` |
| `es` | cristinamagrina.es | Terapia presencial en Barcelona (ES en `/`, EN en `/en/`) | `dist/es` |

## Estructura

```
build.js                  el generador (un solo archivo)
shared/
  layout.html             esqueleto de cada página
  partials/head.html      <head> común (metadatos, hreflang, fuentes, CSS)
  assets/                 CSS, JS e imágenes comunes a los dos sitios
  pages/<idioma>/         páginas compartidas (Sobre mí, Mi enfoque)
sites/<ca|es>/
  site.json               dominio, email, idiomas, asunto del correo de reserva
  partials/<idioma>/      header.html y footer.html (cabecera, menú, pie y ventana de reserva)
  pages/<idioma>/         páginas propias del sitio (una carpeta por idioma)
  assets/                 recursos propios (p. ej. js/config.js); pisan a shared/assets
  static/                 se copia tal cual a la raíz (_redirects, _headers...)
```

Una página de `sites/<id>/pages/<idioma>/` con el mismo nombre que una de `shared/pages/` **sustituye** a la compartida. Así, para dar a España su propio "Sobre mí", basta con crear `sites/es/pages/es/about.html` (y `en/about.html`).

## Uso

```bash
node build.js              # construye los dos sitios en dist/
node build.js check        # construye y comprueba todos los enlaces internos
node build.js serve ca     # vista previa en http://localhost:4173  (es: 4174)
```

(También `npm run build`, `npm run check`, `npm run dev:ca`, `npm run dev:es`.)

Cada página empieza con un bloque `<!--meta { ... } -->` con `title`, `description` y, opcionalmente, `image`, `ogTitle`, `counterparts` (si la versión en el otro idioma tiene otro nombre de archivo), `sitemap: false` o `absolute: true` (rutas absolutas, para páginas 404). Dentro de las páginas y parciales se pueden usar `{{root}}`, `{{base}}`, `{{email}}`, `{{origin}}`, `{{mailSubjectEnc}}`, etc. (ver `build.js`). El build falla si encuentra un `{{token}}` desconocido.

El menú, el pie y la ventana de reserva se editan en `sites/<id>/partials/<idioma>/`. El marcador `{{cur:clave}}` pone `aria-current="page"` en la página activa.

`sitemap.xml` y `robots.txt` se generan solos (`robots` en `site.json`).

## Despliegue en Cloudflare Pages

Crear **dos proyectos** conectados a este mismo repositorio:

| | Proyecto 1 | Proyecto 2 |
|---|---|---|
| Dominio | cristinamagrina.ca | cristinamagrina.es |
| Build command | `node build.js ca` | `node build.js es` |
| Build output directory | `dist/ca` | `dist/es` |
| Rama de producción | `main` | `main` |

Cloudflare sirve `/about.html` como `/about`, por eso los canónicos, hreflang y el sitemap usan URLs sin `.html` (`"cleanUrls": true` en `site.json`). Los enlaces internos con `.html` siguen funcionando (redirigen).

## Pendiente de completar en el sitio de España

Todo lo que necesita un dato real está marcado con `<mark class="todo">[PENDIENTE: ...]</mark>` (o `[TO CONFIRM: ...]` en inglés). Para listarlos:

```bash
git grep -n "mark class=.todo" -- sites/es
```

Antes de publicar, revisar también: el email `info@cristinamagrina.es` (`sites/es/site.json` y `sites/es/assets/js/config.js`), el logo (incluye la palabra "PSYCHOLOGY"), y las páginas compartidas "Sobre mí" y "Mi enfoque", que todavía mencionan Ontario y el CPBAO.
