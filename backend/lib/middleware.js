const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

/**
 * Middleware para verificar el token JWT.
 * El token contiene: { userId, email, name }
 */
function verifyToken(req, res, next) {
    const bearerHeader = req.headers['authorization'];
    if (!bearerHeader) {
        return res.status(401).json({
            error_code: 'AUTH_REQUIRED',
            error_message: 'Token no proporcionado',
            request_id: req.headers['x-request-id'],
        });
    }

    const token = bearerHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            error_code: 'AUTH_REQUIRED',
            error_message: 'Formato de token inválido',
            request_id: req.headers['x-request-id'],
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({
            error_code: 'FORBIDDEN',
            error_message: 'Token inválido o expirado',
            request_id: req.headers['x-request-id'],
        });
    }
}

/**
 * Genera un JWT con la información del usuario.
 */
function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { verifyToken, signToken };
