import{a as y}from"./shared-656IJ7HM.js";import{b,c as w}from"./shared-ASP2VY3Q.js";var I=b(j=>{"use strict";var d=y();function $(e,t){return e===t&&(e!==0||1/e===1/t)||e!==e&&t!==t}var F=typeof Object.is=="function"?Object.is:$,G=d.useState,U=d.useEffect,k=d.useLayoutEffect,B=d.useDebugValue;function H(e,t){var n=t(),o=G({inst:{value:n,getSnapshot:t}}),r=o[0].inst,u=o[1];return k(function(){r.value=n,r.getSnapshot=t,D(r)&&u({inst:r})},[e,n,t]),U(function(){return D(r)&&u({inst:r}),e(function(){D(r)&&u({inst:r})})},[e]),B(n),n}function D(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!F(e,n)}catch{return!0}}function J(e,t){return t()}var K=typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"?J:H;j.useSyncExternalStore=d.useSyncExternalStore!==void 0?d.useSyncExternalStore:K});var x=b((le,R)=>{"use strict";R.exports=I()});var z=b(V=>{"use strict";var S=y(),Q=x();function X(e,t){return e===t&&(e!==0||1/e===1/t)||e!==e&&t!==t}var Y=typeof Object.is=="function"?Object.is:X,Z=Q.useSyncExternalStore,ee=S.useRef,te=S.useEffect,re=S.useMemo,ne=S.useDebugValue;V.useSyncExternalStoreWithSelector=function(e,t,n,o,r){var u=ee(null);if(u.current===null){var f={hasValue:!1,value:null};u.current=f}else f=u.current;u=re(function(){function v(i){if(!E){if(E=!0,s=i,i=o(i),r!==void 0&&f.hasValue){var c=f.value;if(r(c,i))return l=c}return l=i}if(c=l,Y(s,i))return c;var g=o(i);return r!==void 0&&r(c,g)?(s=i,c):(s=i,l=g)}var E=!1,s,l,a=n===void 0?null:n;return[function(){return v(t())},a===null?void 0:function(){return v(a())}]},[t,n,o,r]);var m=Z(e,u[0],u[1]);return te(function(){f.hasValue=!0,f.value=m},[m]),ne(m),m}});var A=b((me,M)=>{"use strict";M.exports=z()});var p=w(y());var h=e=>{let t,n=new Set,o=(s,l)=>{let a=typeof s=="function"?s(t):s;if(!Object.is(a,t)){let i=t;t=l??(typeof a!="object"||a===null)?a:Object.assign({},t,a),n.forEach(c=>c(t,i))}},r=()=>t,v={setState:o,getState:r,getInitialState:()=>E,subscribe:s=>(n.add(s),()=>n.delete(s)),destroy:()=>{(import.meta.env?import.meta.env.MODE:void 0)!=="production"&&console.warn("[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."),n.clear()}},E=t=e(o,r,v);return v},O=e=>e?h(e):h;var P=w(y(),1),q=w(A(),1),{useDebugValue:oe}=P.default,{useSyncExternalStoreWithSelector:ue}=q.default,T=!1,se=e=>e;function ie(e,t=se,n){(import.meta.env?import.meta.env.MODE:void 0)!=="production"&&n&&!T&&(console.warn("[DEPRECATED] Use `createWithEqualityFn` instead of `create` or use `useStoreWithEqualityFn` instead of `useStore`. They can be imported from 'zustand/traditional'. https://github.com/pmndrs/zustand/discussions/1937"),T=!0);let o=ue(e.subscribe,e.getState,e.getServerState||e.getInitialState,t,n);return oe(o),o}var C=e=>{(import.meta.env?import.meta.env.MODE:void 0)!=="production"&&typeof e!="function"&&console.warn("[DEPRECATED] Passing a vanilla store will be unsupported in a future version. Instead use `import { useStore } from 'zustand'`.");let t=typeof e=="function"?O(e):e,n=(o,r)=>ie(t,o,r);return Object.assign(n,t),n},N=e=>e?C(e):C;var W,_,L=typeof window<"u"&&((W=window.document)!=null&&W.createElement||((_=window.navigator)==null?void 0:_.product)==="ReactNative")?p.default.useLayoutEffect:p.default.useEffect;function ae(){let e=N(t=>({current:new Array,version:0,set:t}));return{In:({children:t})=>{let n=e(r=>r.set),o=e(r=>r.version);return L(()=>{n(r=>({version:r.version+1}))},[]),L(()=>(n(({current:r})=>({current:[...r,t]})),()=>n(({current:r})=>({current:r.filter(u=>u!==t)}))),[t,o]),null},Out:()=>{let t=e(n=>n.current);return p.default.createElement(p.default.Fragment,null,t)}}}export{ae as default};
/*! Bundled license information:

use-sync-external-store/cjs/use-sync-external-store-shim.production.js:
  (**
   * @license React
   * use-sync-external-store-shim.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
