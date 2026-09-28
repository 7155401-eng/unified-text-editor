const { DOMParser } = require('@xmldom/xmldom');
const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>hello</w:t></w:p></w:body></w:document>';
const doc = new DOMParser().parseFromString(xml, 'application/xml');
console.log('NS length:', doc.documentElement.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't').length);
console.log('Tag length w:t:', doc.documentElement.getElementsByTagName('w:t').length);
console.log('Tag length t:', doc.documentElement.getElementsByTagName('t').length);
