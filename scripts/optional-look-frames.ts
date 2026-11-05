import {ast,edits,literal,maybeName,nameOf,nodesOf,one} from './source.ts';

export function patchOptionalLookFrames(source:string):string {
  const tree=ast(source);
  const renderer=one(nodesOf(tree,'FunctionDeclaration',fn=>nodesOf(fn,'TemplateLiteral',node=>node.quasis.some(part=>part.value.raw==='ui/frames/')).length>0&&nodesOf(fn,'LogicalExpression',node=>node.operator==='??'&&node.left.type==='MemberExpression'&&maybeName(node.left.property)==='frame'&&node.right.type==='BinaryExpression'&&node.right.operator==='+'&&literal(node.right.left)==='look-').length===1),'optional look frame renderer');
  const guard=one(nodesOf(renderer,'IfStatement',node=>node.test.type==='UnaryExpression'&&node.test.operator==='!'&&node.test.argument.type==='Identifier'&&node.consequent.type==='ReturnStatement'&&literal(node.consequent.argument)===null),'optional look frame guard');
  if(guard.test.type!=='UnaryExpression')throw new Error('Unsupported optional look frame guard');
  const binding=nameOf(guard.test.argument);
  one(nodesOf(renderer,'CallExpression',node=>node.callee.type==='MemberExpression'&&maybeName(node.callee.property)==='remove'),'optional look frame fallback');
  // These three upstream decorations return 404 and the renderer removes them.
  // Preserve that visible fallback without issuing permanently failed requests.
  return edits(source,[{start:guard.end,end:guard.end,text:`if(${binding}.frame==null&&['ember','verdant','tidal'].includes(${binding}.style))return null;`}]);
}
