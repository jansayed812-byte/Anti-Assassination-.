/**
 * Kalman Filter for Position Fusion
 */

export class Matrix3 {
  data: number[][] = [[1,0,0],[0,1,0],[0,0,1]];
  constructor(init?: number[][]) { if (init) this.data = init.map(r => [...r]); }
  static identity(): Matrix3 { return new Matrix3([[1,0,0],[0,1,0],[0,0,1]]); }
  static zero(): Matrix3 { return new Matrix3([[0,0,0],[0,0,0],[0,0,0]]); }
  multiply(o: Matrix3): Matrix3 { const r = Matrix3.zero(); for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) r.data[i][j]+=this.data[i][k]*o.data[k][j]; return r; }
  transpose(): Matrix3 { return new Matrix3([[this.data[0][0],this.data[1][0],this.data[2][0]],[this.data[0][1],this.data[1][1],this.data[2][1]],[this.data[0][2],this.data[1][2],this.data[2][2]]]); }
  add(o: Matrix3): Matrix3 { const r = new Matrix3(); for (let i=0;i<3;i++) for (let j=0;j<3;j++) r.data[i][j]=this.data[i][j]+o.data[i][j]; return r; }
  subtract(o: Matrix3): Matrix3 { const r = new Matrix3(); for (let i=0;i<3;i++) for (let j=0;j<3;j++) r.data[i][j]=this.data[i][j]-o.data[i][j]; return r; }
  invert(): Matrix3 {
    const a = this.data;
    const det = a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0])+a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
    if (Math.abs(det) < 1e-10) return Matrix3.identity();
    const inv = Matrix3.zero();
    inv.data[0][0]=(a[1][1]*a[2][2]-a[1][2]*a[2][1])/det; inv.data[0][1]=-(a[0][1]*a[2][2]-a[0][2]*a[2][1])/det; inv.data[0][2]=(a[0][1]*a[1][2]-a[0][2]*a[1][1])/det;
    inv.data[1][0]=-(a[1][0]*a[2][2]-a[1][2]*a[2][0])/det; inv.data[1][1]=(a[0][0]*a[2][2]-a[0][2]*a[2][0])/det; inv.data[1][2]=-(a[0][0]*a[1][2]-a[0][2]*a[1][0])/det;
    inv.data[2][0]=(a[1][0]*a[2][1]-a[1][1]*a[2][0])/det; inv.data[2][1]=-(a[0][0]*a[2][1]-a[0][1]*a[2][0])/det; inv.data[2][2]=(a[0][0]*a[1][1]-a[0][1]*a[1][0])/det;
    return inv;
  }
}

export class Vector3 {
  constructor(public x=0, public y=0, public z=0) {}
  add(o: Vector3): Vector3 { return new Vector3(this.x+o.x, this.y+o.y, this.z+o.z); }
  subtract(o: Vector3): Vector3 { return new Vector3(this.x-o.x, this.y-o.y, this.z-o.z); }
  scale(s: number): Vector3 { return new Vector3(this.x*s, this.y*s, this.z*s); }
  dot(o: Vector3): number { return this.x*o.x+this.y*o.y+this.z*o.z; }
  magnitude(): number { return Math.sqrt(this.x**2+this.y**2+this.z**2); }
}

export interface KalmanState { position: Vector3; velocity: Vector3; timestamp: number; }

export class KalmanFilter {
  private state: KalmanState;
  private F = Matrix3.identity();
  private P = new Matrix3([[100,0,0],[0,100,0],[0,0,100]]);
  private Q = new Matrix3([[0.1,0,0],[0,0.1,0],[0,0,0.1]]);
  private H = Matrix3.identity();

  constructor(initialPosition = new Vector3(), initialVelocity = new Vector3(), _dt = 0.1) {
    this.state = { position: initialPosition, velocity: initialVelocity, timestamp: Date.now() };
  }

  predict(_dt = 0.1): void {
    const now = Date.now();
    const dt = (now - this.state.timestamp) / 1000;
    this.state.timestamp = now;
    this.state.position = this.state.position.add(this.state.velocity.scale(dt));
    this.P = this.F.multiply(this.P).multiply(this.F.transpose()).add(this.Q);
  }

  update(measurement: Vector3, measurementCovariance: Matrix3, confidence = 1.0): void {
    const innovation = measurement.subtract(this.state.position);
    const R = new Matrix3(measurementCovariance.data.map(r => r.map(v => v / (confidence**2))));
    const S = this.H.multiply(this.P).multiply(this.H.transpose()).add(R);
    const K = this.P.multiply(this.H.transpose()).multiply(S.invert());
    const corr = this._mv(K, innovation);
    this.state.position = this.state.position.add(corr);
    this.P = Matrix3.identity().subtract(K.multiply(this.H)).multiply(this.P);
  }

  private _mv(m: Matrix3, v: Vector3): Vector3 {
    return new Vector3(
      m.data[0][0]*v.x+m.data[0][1]*v.y+m.data[0][2]*v.z,
      m.data[1][0]*v.x+m.data[1][1]*v.y+m.data[1][2]*v.z,
      m.data[2][0]*v.x+m.data[2][1]*v.y+m.data[2][2]*v.z
    );
  }

  getState(): KalmanState { return { position: new Vector3(this.state.position.x,this.state.position.y,this.state.position.z), velocity: new Vector3(this.state.velocity.x,this.state.velocity.y,this.state.velocity.z), timestamp: this.state.timestamp }; }
  getUncertainty(): number { return this.P.data[0][0]+this.P.data[1][1]+this.P.data[2][2]; }
  getPositionUncertainty(): number { return Math.sqrt(Math.max(0,(this.P.data[0][0]+this.P.data[1][1]+this.P.data[2][2])/3)); }
}
