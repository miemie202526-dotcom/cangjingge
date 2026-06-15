/**
 * @typedef {Object} FileRecord
 * @property {string} id
 * @property {string} fileName
 * @property {string} ext
 * @property {string} mimeType
 * @property {string} text
 * @property {string} markdownPreview
 * @property {string} summary
 * @property {number} uploadedAt
 * @property {string[]} tags
 * @property {number} [bytes]
 * @property {number} [charCount]
 * @property {string} [imageDataUrl]
 * @property {boolean} [imageOnly]
 */

/**
 * @typedef {Object} TaskRecord
 * @property {string} id
 * @property {string} type
 * @property {string} title
 * @property {string} summary
 * @property {string} content
 * @property {Record<string, unknown>} meta
 * @property {number} createdAt
 */

/**
 * @typedef {Object} OutputRecord
 * @property {string} id
 * @property {string} taskId
 * @property {string} format
 * @property {string} pathOrNote
 * @property {number} createdAt
 */

export {};
