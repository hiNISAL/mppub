const AuditTask = require('./src/index');
const config = require('./config');

(new AuditTask(config)).bootstrap();
