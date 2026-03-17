# Chatbot FCE - Automatización con n8n

## Descripción de proyecto

Chatbot FCE es una herramienta de chat para los estudiantes de la Facultad de Ciencias Económicas (UNCUYO). A través de ella se pueden hacer consultas académicas/administrativas y obtener respuestas automatizadas rápidamente. La herramienta también es capaz de determinar cuando la situación requiere de intervención humana y derivar el caso a quien corresponda.

El canal de comunicación entre los usuarios y Chatbot FCE es WhatsApp, que se conecta a n8n a través de WhatsApp Cloud API.

## Configuración inicial

- Servidor n8n: contamos con una instancia de n8n dockerizada en un servidor propio
- WhatsApp Cloud API: la configuración requiere de algunos pasos
    - Crear un portfolio de negocios en Facebook
    - Acceder a developers.facebook.com y crear una app
    - Configurar nuestra cuenta de WhatsApp Business API con número y token de autenticación


> ## Descripción en progreso, idea en desarrollo.