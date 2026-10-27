# ManyCords — Firefox Add-ons (español)

## Nombre

ManyCords

## Descripción breve

Reúne los canales de tus servidores en un lector local, con colecciones y líneas de conversación.

## Descripción completa

Reúne los canales de los servidores de Discord que elijas en un lector local. Crea colecciones entre servidores, filtra por fuente, busca en los mensajes recientes capturados y sigue mensajes relacionados mediante líneas de conversación de colores. Lee en español o inglés, con temas claro y oscuro. Marcar una colección como leída solo afecta a este lector.

Mantén abierta tu propia pestaña de Discord para recibir nueva actividad. La extensión solo guarda la actividad que esa pestaña recibe para los canales de tus colecciones; no descarga el historial anterior ni guarda mensajes directos. La colección inicial «Todos» incluye todos los canales de servidores que recibe tu pestaña. Elimínala para limitar la captura a una selección más reducida. Puede haber interrupciones: la captura no garantiza un archivo completo.

Los mensajes, los nombres e identificadores de los autores, los identificadores de sus avatares y los nombres de canales y servidores se quedan en el almacenamiento de la extensión del navegador, en tu dispositivo. Los datos capturados nunca se nos envían a nosotros ni a terceros. Las únicas solicitudes de red que hace la extensión son cargas de imágenes de cdn.discordapp.com y media.discordapp.net para avatares, iconos de servidores y miniaturas. No hay analítica ni cuentas adicionales. El plazo de conservación es configurable, con un valor predeterminado de 14 días; puedes eliminar todos los datos capturados desde el menú del lector. Al desinstalarla se eliminan todos los datos almacenados.

La captura de actividad desde el navegador no está autorizada por Discord y puede infringir sus condiciones de servicio. Tu cuenta podría sufrir restricciones o ser suspendida. Úsala bajo tu responsabilidad. Consulta las [condiciones de Discord](https://discord.com/terms).

ManyCords is not affiliated with or endorsed by Discord Inc.

## Categoría sugerida

Fuentes, noticias y blogs

## Finalidad única

Ofrecer un lector local de los mensajes que la propia pestaña de Discord del usuario recibe para los canales elegidos en sus colecciones.

## Justificación de permisos

- `storage`: guarda las colecciones, las preferencias del lector y el estado local en el dispositivo mediante la API de almacenamiento de extensiones del navegador.
- `unlimitedStorage`: permite que el archivo local de mensajes en IndexedDB del origen de la extensión supere las cuotas normales de almacenamiento. No sube ni sincroniza datos.
- Acceso al sitio `https://discord.com/*`: observa los mensajes y la información de canales y servidores que ya recibe la propia pestaña de Discord del usuario y envía la actividad seleccionada por las colecciones al lector local. No se solicita acceso a otros sitios web.
- `alarms`: el manifiesto actual no solicita este permiso y esta versión no lo usa. Para una versión que implemente la limpieza programada, la justificación es: «Programa la eliminación local de los registros capturados que superan el plazo de conservación configurado por el usuario, sin enviar datos por la red». Usa esta justificación solo cuando la función y el permiso estén presentes.

No se carga código ejecutable remoto; los scripts y las fuentes se incluyen en la extensión.

## Declaraciones de uso de datos

- Finalidad: leer localmente los canales seleccionados mediante las colecciones del usuario.
- Datos tratados en el dispositivo: mensajes (comunicaciones personales y contenido de sitios web), nombres e identificadores de autores e identificadores de avatares (información de identificación personal), y nombres de canales y servidores (contenido de sitios web). El tratamiento local no significa que no se traten datos del usuario.
- Almacenamiento: solo en el almacenamiento de la extensión del navegador en el dispositivo, incluido IndexedDB del origen de la extensión; sin almacenamiento en servidores ni sincronización.
- Transmisión: los datos capturados nunca se envían al desarrollador ni a terceros. Las únicas solicitudes de red de la extensión son cargas de imágenes de la CDN de Discord (cdn.discordapp.com y media.discordapp.net) para avatares, iconos de servidores y miniaturas. Estas solicitudes de imágenes llegan a Discord; los mensajes capturados no se suben.
- Conservación y eliminación: plazo configurable, de 14 días de forma predeterminada; eliminación de todos los datos capturados desde el menú del lector; desinstalar elimina todos los datos almacenados.
- Sin analítica ni cuentas de la extensión. Los datos no se venden ni se usan para publicidad, fines ajenos al lector o evaluación crediticia. Solo se usan para la finalidad indicada.
- Política de privacidad: publica docs/privacy.es.html en GitHub Pages e introduce su URL pública real en el campo de privacidad de la tienda. Versión en inglés: docs/privacy.html. Contacto: CONTACT_EMAIL.

Comprobación antes del envío: la política y la ficha describen la conservación y la eliminación completa exigidas por el encargo de publicación. Este código aún no implementa la conservación configurable y su acción de borrado conserva las colecciones y los metadatos de canales. Resuelve esa diferencia antes del envío; no certifiques el comportamiento descrito para la versión actual.

Para la revisión de Mozilla: no se transmiten datos capturados; las solicitudes externas se limitan a las imágenes de la CDN descritas. Declara esas cargas en las notas de revisión y comprueba que las declaraciones de datos del manifiesto coinciden con la versión enviada. Consulta las [políticas oficiales de complementos](https://extensionworkshop.com/documentation/publish/add-on-policies/).
