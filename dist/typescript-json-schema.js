/// <reference path="typings/typescript/typescript.d.ts" />
/// <reference path="typings/glob/glob.d.ts" />
var ts = require("typescript");
var glob = require("glob");
var vm = require("vm");
var TJS;
(function (TJS) {
    var JsonSchemaGenerator = (function () {
        function JsonSchemaGenerator(allSymbols, inheritingTypes, tc) {
            this.sandbox = { sandboxvar: null };
            this.allSymbols = allSymbols;
            this.inheritingTypes = inheritingTypes;
            this.tc = tc;
        }
        /**
         * (source: Typson)
         * Extracts the schema validation keywords stored in a comment and register them as properties.
         * A validation keyword starts by a @. It has a name and a value. Several keywords may occur.
         *
         * @param comment {string} the full comment.
         * @param to {object} the destination variable.
         */
        JsonSchemaGenerator.prototype.copyValidationKeywords = function (comment, to) {
            JsonSchemaGenerator.annotedValidationKeywordPattern.lastIndex = 0;
            // TODO: to improve the use of the exec method: it could make the tokenization
            var annotation;
            while ((annotation = JsonSchemaGenerator.annotedValidationKeywordPattern.exec(comment))) {
                var annotationTokens = annotation[0].split(" ");
                var keyword = annotationTokens[0].slice(1);
                var path = keyword.split(".");
                var context = null;
                // TODO: paths etc. originate from Typson, not supported atm.
                if (path.length > 1) {
                    context = path[0];
                    keyword = path[1];
                }
                keyword = keyword.replace("TJS-", "");
                // case sensitive check inside the dictionary
                if (JsonSchemaGenerator.validationKeywords.indexOf(keyword) >= 0 || JsonSchemaGenerator.validationKeywords.indexOf("TJS-" + keyword) >= 0) {
                    var value = annotationTokens.length > 1 ? annotationTokens.slice(1).join(" ") : "";
                    try {
                        value = JSON.parse(value);
                    }
                    catch (e) {
                        console.error(e);
                    }
                    if (context) {
                        if (!to[context]) {
                            to[context] = {};
                        }
                        to[context][keyword] = value;
                    }
                    else {
                        to[keyword] = value;
                    }
                }
            }
        };
        /**
         * (source: Typson)
         * Extracts the description part of a comment and register it in the description property.
         * The description is supposed to start at first position and may be delimited by @.
         *
         * @param comment {string} the full comment.
         * @param to {object} the destination variable or definition.
         * @returns {string} the full comment minus the beginning description part.
         */
        JsonSchemaGenerator.prototype.copyDescription = function (comment, to) {
            var delimiter = "@";
            var delimiterIndex = comment.indexOf(delimiter);
            var description = comment.slice(0, delimiterIndex < 0 ? comment.length : delimiterIndex);
            if (description.length > 0) {
                to.description = description.replace(/\s+$/g, "");
            }
            return delimiterIndex < 0 ? "" : comment.slice(delimiterIndex);
        };
        JsonSchemaGenerator.prototype.parseCommentsIntoDefinition = function (comments, definition) {
            if (!comments || !comments.length) {
                return;
            }
            var joined = comments.map(function (comment) { return comment.text.trim(); }).join("\n");
            joined = this.copyDescription(joined, definition);
            this.copyValidationKeywords(joined, definition);
        };
        JsonSchemaGenerator.prototype.getDefinitionForType = function (propertyType, tc) {
            var propertyTypeString = tc.typeToString(propertyType, undefined, 128 /* UseFullyQualifiedType */);
            var definition = {};
            switch (propertyTypeString.toLowerCase()) {
                case "string":
                    definition.type = "string";
                    break;
                case "number":
                    definition.type = "number";
                    break;
                case "boolean":
                    definition.type = "boolean";
                    break;
                case "any":
                    definition.type = "object";
                    break;
                default:
                    if (propertyType.getSymbol().getName() == "Array") {
                        var arrayType = propertyType.typeArguments[0];
                        definition.type = "array";
                        definition.items = this.getDefinitionForType(arrayType, tc);
                    }
                    else {
                        var definition_1 = this.getClassDefinition(propertyType, tc);
                        return definition_1;
                    }
            }
            return definition;
        };
        JsonSchemaGenerator.prototype.getDefinitionForProperty = function (prop, tc, node) {
            var propertyName = prop.getName();
            var propertyType = tc.getTypeOfSymbolAtLocation(prop, node);
            var propertyTypeString = tc.typeToString(propertyType, undefined, 128 /* UseFullyQualifiedType */);
            var definition = this.getDefinitionForType(propertyType, tc);
            definition.title = propertyName;
            var comments = prop.getDocumentationComment();
            this.parseCommentsIntoDefinition(comments, definition);
            if (definition.hasOwnProperty("ignore")) {
                return null;
            }
            // try to get default value
            var initial = prop.valueDeclaration.initializer;
            if (initial) {
                if (initial.expression) {
                    console.warn("initializer is expression for property " + propertyName);
                }
                else if (initial.kind && initial.kind == 11 /* NoSubstitutionTemplateLiteral */) {
                    definition.default = initial.getText();
                }
                else {
                    try {
                        var sandbox = { sandboxvar: null };
                        vm.runInNewContext("sandboxvar=" + initial.getText(), sandbox);
                        initial = sandbox.sandboxvar;
                        if (initial == null) {
                        }
                        else if (typeof (initial) === "string" || typeof (initial) === "number" || typeof (initial) === "boolean" || Object.prototype.toString.call(initial) === '[object Array]') {
                            definition.default = initial;
                        }
                        else {
                            console.warn("unknown initializer for property " + propertyName + ": " + initial);
                        }
                    }
                    catch (e) {
                        console.warn("exception evaluating initializer for property " + propertyName);
                    }
                }
            }
            return definition;
        };
        JsonSchemaGenerator.prototype.getClassDefinitionByName = function (clazzName) {
            return this.getClassDefinition(this.allSymbols[clazzName], this.tc);
        };
        JsonSchemaGenerator.prototype.getClassDefinition = function (clazzType, tc) {
            var _this = this;
            var node = clazzType.getSymbol().getDeclarations()[0];
            var clazz = node;
            var props = tc.getPropertiesOfType(clazzType);
            var fullName = tc.typeToString(clazzType, undefined, 128 /* UseFullyQualifiedType */);
            if (clazz.flags & 256 /* Abstract */) {
                var oneOf = this.inheritingTypes[fullName].map(function (typename) {
                    return _this.getClassDefinition(_this.allSymbols[typename], tc);
                });
                var definition = {
                    "oneOf": oneOf
                };
                return definition;
            }
            else {
                var propertyDefinitions = props.reduce(function (all, prop) {
                    var propertyName = prop.getName();
                    var definition = _this.getDefinitionForProperty(prop, tc, node);
                    if (definition != null) {
                        all[propertyName] = definition;
                    }
                    return all;
                }, {});
                var definition = {
                    "type": "object",
                    "title": fullName,
                    "defaultProperties": [],
                    properties: propertyDefinitions
                };
                return definition;
            }
        };
        JsonSchemaGenerator.validationKeywords = [
            "ignore", "description", "type", "minimum", "exclusiveMinimum", "maximum",
            "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "format",
            "pattern", "minItems", "maxItems", "uniqueItems", "default",
            "additionalProperties", "enum"];
        JsonSchemaGenerator.annotedValidationKeywordPattern = /@[a-z.-]+\s*[^@]+/gi;
        return JsonSchemaGenerator;
    })();
    function generateSchema(compileFiles, fullTypeName) {
        var options = { noEmit: true, emitDecoratorMetadata: true, experimentalDecorators: true, target: 1 /* ES5 */ };
        var program = ts.createProgram(compileFiles, options);
        var tc = program.getTypeChecker();
        var diagnostics = program.getGlobalDiagnostics().concat(program.getDeclarationDiagnostics(), program.getSemanticDiagnostics());
        if (diagnostics.length == 0) {
            var allSymbols = {};
            var inheritingTypes = {};
            program.getSourceFiles().forEach(function (sourceFile) {
                function inspect(node, tc) {
                    if (node.kind == 212 /* ClassDeclaration */ || node.kind == 213 /* InterfaceDeclaration */) {
                        var nodeType = tc.getTypeAtLocation(node);
                        var fullName = tc.typeToString(nodeType, undefined, 128 /* UseFullyQualifiedType */);
                        allSymbols[fullName] = nodeType;
                        nodeType.getBaseTypes().forEach(function (baseType) {
                            var baseName = tc.typeToString(baseType, undefined, 128 /* UseFullyQualifiedType */);
                            if (!inheritingTypes[baseName]) {
                                inheritingTypes[baseName] = [];
                            }
                            inheritingTypes[baseName].push(fullName);
                        });
                    }
                    else {
                        ts.forEachChild(node, function (node) { return inspect(node, tc); });
                    }
                }
                inspect(sourceFile, tc);
            });
            var generator = new JsonSchemaGenerator(allSymbols, inheritingTypes, tc);
            var definition = generator.getClassDefinitionByName(fullTypeName);
            return definition;
        }
        else {
            diagnostics.forEach(function (diagnostic) { return console.warn(diagnostic.messageText + " " + diagnostic.file.fileName + " " + diagnostic.start); });
        }
    }
    TJS.generateSchema = generateSchema;
    function exec(filePattern, fullTypeName) {
        var files = glob.sync(filePattern);
        var definition = TJS.generateSchema(files, fullTypeName);
        console.log(JSON.stringify(definition, null, 4));
        //fs.writeFile(outFile, JSON.stringify(definition, null, 4));
    }
    TJS.exec = exec;
})(TJS = exports.TJS || (exports.TJS = {}));
if (typeof window === "undefined" && require.main === module) {
    if (process.argv[3]) {
        TJS.exec(process.argv[2], process.argv[3]);
    }
    else {
        console.log("Usage: node typescript-json-schema.js <path-to-typescript-files> <type>\n");
    }
}
//TJS.exec("example/**/*.ts", "Invoice");
//node typescript-json-schema.js example/**/*.ts Invoice
//debugger;
//# sourceMappingURL=typescript-json-schema.js.map