export function step(array) {
    const next = Array.prototype.pop.call(array);

    Array.prototype.unshift.call(array, next);

    return next;
}

export const wrapIndex = (index, array) =>
    array[(array.length+Math.round(index))%array.length];


const invLog2 = 1/Math.log(2);

export const nextPow2 = (x) => Math.pow(2, Math.ceil(Math.log(x)*invLog2));


// Handle paths on different hosts - for local/Github/etc hosting.
// @todo Coupled to the hosting setup - remove where not relevant.
export const rootPath =
    `/${((location.href.match(/:\/\/.+?\/([^\/\?]+?(?=[\/\?]|$))?/i) || [])[1] || '')}/`
        .replace(/\/+/gi, '/');
